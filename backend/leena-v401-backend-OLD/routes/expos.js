// routes/expos.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');

/**
 * Generate URL-friendly slug from expo name
 * @param {string} name - The expo name to convert
 * @returns {string} URL-friendly slug
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/[^\w-]+/g, '')        // Remove non-alphanumeric characters
    .replace(/--+/g, '-')           // Replace multiple hyphens with single
    .replace(/^-+|-+$/g, '');       // Remove leading/trailing hyphens
}

/**
 * Generate unique slug by checking database
 * @param {string} baseName - The expo name to convert
 * @param {number} organizerId - The organizer ID
 * @returns {Promise<string>} Unique slug
 */
async function generateUniqueSlug(baseName, organizerId) {
  let slug = generateSlug(baseName);
  let counter = 1;
  
  while (true) {
    const existing = await pool.query(
      'SELECT id FROM expos WHERE slug = $1 AND organizer_id = $2',
      [slug, organizerId]
    );
    
    if (existing.rows.length === 0) {
      return slug;
    }
    
    // Add counter to make it unique
    slug = `${generateSlug(baseName)}-${counter}`;
    counter++;
  }
}

/**
 * GET /api/expos
 * Get all expos for the authenticated organizer
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, organizer_id, name, slug, location, start_date, end_date, 
              logo_url, created_at, updated_at,
              (SELECT COUNT(*) FROM visitors WHERE expo_id = expos.id) as visitor_count
       FROM expos 
       WHERE organizer_id = $1 
       ORDER BY start_date DESC, id DESC`,
      [req.organizer_id]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching expos:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/expos/:id
 * Get a specific expo by ID
 */
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT e.*, 
              (SELECT COUNT(*) FROM visitors WHERE expo_id = e.id) as visitor_count,
              (SELECT COUNT(*) FROM checkins WHERE expo_id = e.id) as checkin_count
       FROM expos e
       WHERE e.id = $1 AND e.organizer_id = $2`,
      [id, req.organizer_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expo not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching expo:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/expos/slug/:slug
 * Get expo by slug (useful for public forms)
 */
router.get('/slug/:slug', async (req, res) => {
  const { slug } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT id, name, slug, location, start_date, end_date, logo_url FROM expos WHERE slug = $1',
      [slug]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expo not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching expo by slug:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/expos
 * Create a new expo
 */
router.post('/', authenticateToken, async (req, res) => {
  const { name, location, start_date, end_date, logo_url, description } = req.body;

  // Validate required fields
  if (!name || !start_date || !end_date) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      required: ['name', 'start_date', 'end_date']
    });
  }

  // Validate date format and logic
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);
  
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  
  if (startDate > endDate) {
    return res.status(400).json({ error: 'Start date must be before end date' });
  }

  try {
    // Generate unique slug
    const slug = await generateUniqueSlug(name, req.organizer_id);

    // Insert new expo
    const result = await pool.query(
      `INSERT INTO expos (organizer_id, name, slug, location, start_date, end_date, logo_url, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.organizer_id, name, slug, location || null, start_date, end_date, logo_url || null, description || null]
    );

    // ÖNEMLİ DEĞİŞİKLİK: expo objesinin tamamını döndürüyoruz
    const newExpo = result.rows[0];
    
    res.status(201).json({
      message: 'Expo created successfully',
      expo: {
        id: newExpo.id,
        organizer_id: newExpo.organizer_id,
        name: newExpo.name,
        slug: newExpo.slug,
        location: newExpo.location,
        start_date: newExpo.start_date,
        end_date: newExpo.end_date,
        logo_url: newExpo.logo_url,
        description: newExpo.description,
        created_at: newExpo.created_at,
        updated_at: newExpo.updated_at
      }
    });
  } catch (err) {
    console.error('Error creating expo:', err);
    
    // Handle unique constraint violation
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An expo with this name already exists' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/expos/:id
 * Update an existing expo
 */
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, location, start_date, end_date, logo_url, description } = req.body;

  // Validate at least one field to update
  if (!name && !location && !start_date && !end_date && !logo_url && description === undefined) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  // Validate dates if provided
  if (start_date && end_date) {
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    if (startDate > endDate) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }
  }

  try {
    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
      
      // Update slug if name changed
      const slug = await generateUniqueSlug(name, req.organizer_id);
      updates.push(`slug = $${paramCount}`);
      values.push(slug);
      paramCount++;
    }

    if (location !== undefined) {
      updates.push(`location = $${paramCount}`);
      values.push(location);
      paramCount++;
    }

    if (start_date) {
      updates.push(`start_date = $${paramCount}`);
      values.push(start_date);
      paramCount++;
    }

    if (end_date) {
      updates.push(`end_date = $${paramCount}`);
      values.push(end_date);
      paramCount++;
    }

    if (logo_url !== undefined) {
      updates.push(`logo_url = $${paramCount}`);
      values.push(logo_url);
      paramCount++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`);
      values.push(description);
      paramCount++;
    }

    // Add updated_at timestamp
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    // Add WHERE clause parameters
    values.push(id, req.organizer_id);

    const query = `
      UPDATE expos 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount} AND organizer_id = $${paramCount + 1}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expo not found' });
    }

    res.json({
      message: 'Expo updated successfully',
      expo: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating expo:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/expos/:id
 * Delete an expo (soft delete or hard delete based on config)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { force } = req.query; // ?force=true for hard delete

  try {
    // Check if expo has visitors
    const visitorCheck = await pool.query(
      'SELECT COUNT(*) as count FROM visitors WHERE expo_id = $1',
      [id]
    );

    const visitorCount = parseInt(visitorCheck.rows[0].count);

    if (visitorCount > 0 && !force) {
      return res.status(400).json({
        error: 'Cannot delete expo with visitors',
        visitor_count: visitorCount,
        message: 'Use ?force=true to delete expo and all associated data'
      });
    }

    if (force === 'true') {
      // Hard delete with cascade
      await pool.query('BEGIN');
      
      try {
        // Delete in order of dependencies
        await pool.query('DELETE FROM checkins WHERE expo_id = $1', [id]);
        await pool.query('DELETE FROM visitors WHERE expo_id = $1', [id]);
        await pool.query('DELETE FROM forms WHERE expo_id = $1', [id]);
        
        const result = await pool.query(
          'DELETE FROM expos WHERE id = $1 AND organizer_id = $2 RETURNING id, name',
          [id, req.organizer_id]
        );

        if (result.rows.length === 0) {
          await pool.query('ROLLBACK');
          return res.status(404).json({ error: 'Expo not found' });
        }

        await pool.query('COMMIT');
        
        res.json({
          message: 'Expo and all associated data deleted successfully',
          deleted: result.rows[0]
        });
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    } else {
      // Simple delete (will fail if there are foreign key constraints)
      const result = await pool.query(
        'DELETE FROM expos WHERE id = $1 AND organizer_id = $2 RETURNING id, name',
        [id, req.organizer_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Expo not found' });
      }

      res.json({
        message: 'Expo deleted successfully',
        deleted: result.rows[0]
      });
    }
  } catch (err) {
    console.error('Error deleting expo:', err);
    
    if (err.code === '23503') { // Foreign key violation
      return res.status(400).json({
        error: 'Cannot delete expo due to existing references',
        hint: 'Use ?force=true to delete expo and all associated data'
      });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/expos/:id/stats
 * Get statistics for a specific expo
 */
router.get('/:id/stats', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Verify expo ownership
    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );

    if (expoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Expo not found' });
    }

    // Get comprehensive statistics
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM visitors WHERE expo_id = $1) as total_visitors,
        (SELECT COUNT(*) FROM visitors WHERE expo_id = $1 AND created_at >= CURRENT_DATE) as visitors_today,
        (SELECT COUNT(*) FROM checkins WHERE expo_id = $1) as total_checkins,
        (SELECT COUNT(DISTINCT visitor_id) FROM checkins WHERE expo_id = $1) as unique_checkins,
        (SELECT COUNT(*) FROM checkins WHERE expo_id = $1 AND checkin_time >= CURRENT_DATE) as checkins_today,
        (SELECT COUNT(*) FROM visitors WHERE expo_id = $1 AND custom_fields->>'country' IS NOT NULL) as visitors_with_country,
        (SELECT json_agg(DISTINCT custom_fields->>'country') FROM visitors WHERE expo_id = $1 AND custom_fields->>'country' IS NOT NULL) as countries
    `, [id]);

    res.json({
      expo_id: id,
      statistics: stats.rows[0],
      generated_at: new Date()
    });
  } catch (err) {
    console.error('Error fetching expo stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
