// routes/import-checkins.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const Papa = require('papaparse');
const { pool } = require('../utils/db');
const { verifyToken } = require('../utils/auth');

// Configure multer for memory storage
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    }
});

// Import check-ins from CSV
router.post('/import-checkins', verifyToken, upload.single('csvFile'), async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'No CSV file uploaded' 
            });
        }

        // Parse CSV
        const csvContent = req.file.buffer.toString('utf-8');
        const parseResult = Papa.parse(csvContent, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            delimitersToGuess: [',', '\t', '|', ';']
        });

        if (parseResult.errors.length > 0) {
            console.error('CSV parsing errors:', parseResult.errors);
        }

        const data = parseResult.data;
        
        // Filter records with visitorId
        const validRecords = data.filter(row => {
            // Clean column names (remove whitespace)
            const cleanRow = {};
            Object.keys(row).forEach(key => {
                const cleanKey = key.trim();
                cleanRow[cleanKey] = row[key];
            });
            return cleanRow.visitorId && cleanRow.visitorId !== null && cleanRow.visitorId !== '';
        });

        if (validRecords.length === 0) {
            return res.json({
                success: false,
                message: 'No valid records found with visitorId',
                totalProcessed: 0,
                successCount: 0,
                errorCount: data.length
            });
        }

        // Begin transaction
        await client.query('BEGIN');

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // Process each record
        for (const record of validRecords) {
            try {
                // Clean column names for this record
                const cleanRecord = {};
                Object.keys(record).forEach(key => {
                    const cleanKey = key.trim();
                    cleanRecord[cleanKey] = record[key];
                });

                // Parse timestamp
                let checkinTime = null;
                if (cleanRecord.timestamp) {
                    checkinTime = new Date(cleanRecord.timestamp);
                    if (isNaN(checkinTime.getTime())) {
                        checkinTime = new Date(); // fallback to current time
                    }
                } else {
                    checkinTime = new Date();
                }

                // Insert into checkins table
                const insertQuery = `
                    INSERT INTO checkins (
                        visitor_id,
                        expo_id,
                        source,
                        terminal,
                        checkin_time,
                        hall,
                        checkin_type,
                        notes,
                        staff_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT DO NOTHING
                    RETURNING id
                `;

                const values = [
                    parseInt(cleanRecord.visitorId),  // visitor_id
                    1,                                 // expo_id (fixed to 1)
                    'log-recovery',                    // source
                    'recovered-terminal',              // terminal
                    checkinTime,                       // checkin_time
                    null,                             // hall
                    null,                             // checkin_type
                    `Badge: ${cleanRecord.badgeId || 'N/A'}, Line: ${cleanRecord.lineNumber || 'N/A'}`, // notes
                    null                              // staff_id
                ];

                const result = await client.query(insertQuery, values);
                
                if (result.rowCount > 0) {
                    successCount++;
                } else {
                    // Record was skipped due to conflict (duplicate)
                    errorCount++;
                    errors.push(`Line ${cleanRecord.lineNumber || 'unknown'}: Duplicate check-in for visitor ${cleanRecord.visitorId}`);
                }

            } catch (recordError) {
                errorCount++;
                const errorMsg = `Line ${record.lineNumber || 'unknown'}: ${recordError.message}`;
                errors.push(errorMsg);
                console.error('Error processing record:', recordError);
            }
        }

        // Commit transaction
        await client.query('COMMIT');

        // Prepare response
        const response = {
            success: true,
            message: `Import completed: ${successCount} records imported successfully`,
            totalProcessed: validRecords.length,
            successCount: successCount,
            errorCount: errorCount,
            errors: errors.slice(0, 100) // Limit errors in response
        };

        if (errorCount > 0) {
            response.message += `, ${errorCount} records failed or skipped`;
        }

        res.json(response);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Import error:', error);
        res.status(500).json({
            success: false,
            message: 'Error during import: ' + error.message,
            totalProcessed: 0,
            successCount: 0,
            errorCount: 0
        });
    } finally {
        client.release();
    }
});

// Get import statistics
router.get('/import-stats', verifyToken, async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) as total_recovered,
                MIN(checkin_time) as first_checkin,
                MAX(checkin_time) as last_checkin
            FROM checkins
            WHERE source = 'log-recovery'
        `;

        const result = await pool.query(statsQuery);
        
        res.json({
            success: true,
            stats: result.rows[0]
        });

    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting import statistics'
        });
    }
});

module.exports = router;
