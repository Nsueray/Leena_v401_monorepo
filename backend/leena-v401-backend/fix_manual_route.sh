#!/bin/bash
# Fix manual route in visitors.js - lines 239-274
# Backup first
cp routes/visitors.js routes/visitors.js.bak

python3 << 'PYEOF'
with open('routes/visitors.js', 'r') as f:
    lines = f.readlines()

# Replace lines 239-274 (0-indexed: 238-273)
new_route = """router.post('/manual', async (req, res) => {
  try {
    const { name, last_name, email, company, job_title, country, expo_id, organizer_id, visitor_type, origin, source } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const qrCode = uuidv4();
    const badgeId = qrCode.substring(0, 8).toUpperCase();
    const badgeUrl = generateBadgeUrl(qrCode);

    const result = await pool.query(
      `INSERT INTO visitors (name, last_name, email, company, job_title, country,
        expo_id, organizer_id, visitor_type, origin, source,
        qr_code, badge_id, badge_url, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      RETURNING id, qr_code, badge_id`,
      [name || '', last_name || '', email, company || '',
       job_title || '', country || '',
       expo_id || null, organizer_id || null,
       visitor_type || 'visitor', origin || 'onsite', source || 'manual',
       qrCode, badgeId, badgeUrl]
    );

    const visitor = result.rows[0];

    res.json({
      success: true,
      qr_code: visitor.qr_code,
      badge_id: visitor.badge_id,
      visitor_id: visitor.id
    });

  } catch (err) {
    console.error('❌ Manual registration error:', err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});
"""

before = lines[:238]
after = lines[274:]
new_lines = new_route.split('\n')
new_lines = [line + '\n' for line in new_lines]

with open('routes/visitors.js', 'w') as f:
    f.writelines(before)
    f.writelines(new_lines)
    f.writelines(after)

print('✅ Manual route fixed successfully')
PYEOF
