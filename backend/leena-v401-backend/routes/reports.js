// routes/reports.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');

/**
 * GET /api/reports/summary
 * Get comprehensive summary report for organizer or specific expo
 */
router.get('/summary', authenticateToken, async (req, res) => {
  const { expo_id, start_date, end_date, include_details = 'false' } = req.query;

  try {
    let report = {};
    
    if (expo_id) {
      // Verify expo ownership
      const expoCheck = await pool.query(
        'SELECT id, name, start_date, end_date FROM expos WHERE id = $1 AND organizer_id = $2',
        [expo_id, req.organizer_id]
      );

      if (expoCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied to this expo' });
      }

      // EXPO-SPECIFIC REPORT
      report = await generateExpoReport(expo_id, start_date, end_date, include_details === 'true');
      report.expo_info = expoCheck.rows[0];
    } else {
      // ORGANIZER-WIDE REPORT
      report = await generateOrganizerReport(req.organizer_id, start_date, end_date, include_details === 'true');
    }

    report.generated_at = new Date();
    report.period = {
      start: start_date || 'all time',
      end: end_date || 'now'
    };

    res.json(report);
  } catch (err) {
    console.error('Error generating summary report:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

/**
 * Generate report for a specific expo
 */
async function generateExpoReport(expoId, startDate, endDate, includeDetails) {
  // Build date filter
  let dateFilter = '';
  const params = [expoId];
  let paramCount = 2;

  if (startDate) {
    dateFilter += ` AND v.created_at >= $${paramCount}`;
    params.push(startDate);
    paramCount++;
  }
  if (endDate) {
    dateFilter += ` AND v.created_at <= $${paramCount}`;
    params.push(endDate);
    paramCount++;
  }

  // Main statistics query
  const statsQuery = `
    WITH visitor_stats AS (
      SELECT 
        COUNT(*) as total_visitors,
        COUNT(DISTINCT COALESCE(NULLIF(custom_fields->>'email', ''), email)) as unique_emails,
        COUNT(DISTINCT COALESCE(NULLIF(custom_fields->>'company', ''), company)) as unique_companies,
        COUNT(DISTINCT COALESCE(NULLIF(custom_fields->>'country', ''), country)) as unique_countries,
        COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as registrations_today,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as registrations_week,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as registrations_month,
        AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at))/86400)::numeric(10,2) as avg_days_since_registration
      FROM visitors v
      WHERE expo_id = $1 ${dateFilter}
    ),
    checkin_stats AS (
      SELECT 
        COUNT(*) as total_checkins,
        COUNT(DISTINCT visitor_id) as unique_visitors_checked_in,
        COUNT(CASE WHEN checkin_time >= CURRENT_DATE THEN 1 END) as checkins_today,
        COUNT(CASE WHEN checkin_type = 'entry' THEN 1 END) as entries,
        COUNT(CASE WHEN checkin_type = 'exit' THEN 1 END) as exits,
        COUNT(CASE WHEN checkin_type = 're-entry' THEN 1 END) as reentries
      FROM checkins
      WHERE expo_id = $1
    ),
    email_stats AS (
      SELECT 
        COUNT(*) as total_emails_sent,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as emails_delivered,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as emails_failed
      FROM email_logs el
      WHERE EXISTS (SELECT 1 FROM visitors v WHERE v.id = el.visitor_id AND v.expo_id = $1)
    )
    SELECT 
      vs.*,
      cs.*,
      es.*,
      CASE 
        WHEN vs.total_visitors > 0 
        THEN (cs.unique_visitors_checked_in::float / vs.total_visitors * 100)::numeric(5,2)
        ELSE 0 
      END as checkin_rate
    FROM visitor_stats vs, checkin_stats cs, email_stats es
  `;

  const statsResult = await pool.query(statsQuery, params);
  const stats = statsResult.rows[0];

  // Top countries
  const countriesQuery = `
    SELECT 
      COALESCE(NULLIF(custom_fields->>'country', ''), country) as country,
      COUNT(*) as count,
      ROUND((COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM visitors WHERE expo_id = $1), 0)), 2) as percentage
    FROM visitors
    WHERE expo_id = $1 
    AND COALESCE(NULLIF(custom_fields->>'country', ''), country) IS NOT NULL
    ${dateFilter}
    GROUP BY COALESCE(NULLIF(custom_fields->>'country', ''), country)
    ORDER BY count DESC
    LIMIT 10
  `;
  const countriesResult = await pool.query(countriesQuery, params);

  // Top companies
  const companiesQuery = `
    SELECT 
      COALESCE(NULLIF(custom_fields->>'company', ''), company) as company,
      COUNT(*) as count,
      COUNT(DISTINCT COALESCE(NULLIF(custom_fields->>'email', ''), email)) as unique_visitors
    FROM visitors
    WHERE expo_id = $1 
    AND COALESCE(NULLIF(custom_fields->>'company', ''), company) IS NOT NULL
    ${dateFilter}
    GROUP BY COALESCE(NULLIF(custom_fields->>'company', ''), company)
    ORDER BY count DESC
    LIMIT 10
  `;
  const companiesResult = await pool.query(companiesQuery, params);

  // Registration sources
  const sourcesQuery = `
    SELECT 
      source,
      COUNT(*) as count,
      ROUND((COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM visitors WHERE expo_id = $1), 0)), 2) as percentage
    FROM visitors
    WHERE expo_id = $1
    ${dateFilter}
    GROUP BY source
    ORDER BY count DESC
  `;
  const sourcesResult = await pool.query(sourcesQuery, params);

  // Daily registration trend (last 30 days)
  const trendQuery = `
    SELECT 
      DATE(created_at) as date,
      COUNT(*) as registrations,
      COUNT(DISTINCT COALESCE(NULLIF(custom_fields->>'email', ''), email)) as unique_registrations
    FROM visitors
    WHERE expo_id = $1
    AND created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `;
  const trendResult = await pool.query(trendQuery, [expoId]);

  // Hourly distribution for today
  const hourlyQuery = `
    SELECT 
      EXTRACT(HOUR FROM created_at) as hour,
      COUNT(*) as count
    FROM visitors
    WHERE expo_id = $1
    AND DATE(created_at) = CURRENT_DATE
    GROUP BY EXTRACT(HOUR FROM created_at)
    ORDER BY hour
  `;
  const hourlyResult = await pool.query(hourlyQuery, [expoId]);

  // Build report object
  const report = {
    visitor_metrics: {
      total_visitors: parseInt(stats.total_visitors),
      unique_emails: parseInt(stats.unique_emails),
      unique_companies: parseInt(stats.unique_companies),
      unique_countries: parseInt(stats.unique_countries),
      registrations_today: parseInt(stats.registrations_today),
      registrations_week: parseInt(stats.registrations_week),
      registrations_month: parseInt(stats.registrations_month),
      avg_days_since_registration: parseFloat(stats.avg_days_since_registration)
    },
    checkin_metrics: {
      total_checkins: parseInt(stats.total_checkins),
      unique_visitors_checked_in: parseInt(stats.unique_visitors_checked_in),
      checkin_rate: parseFloat(stats.checkin_rate),
      checkins_today: parseInt(stats.checkins_today),
      by_type: {
        entries: parseInt(stats.entries),
        exits: parseInt(stats.exits),
        reentries: parseInt(stats.reentries)
      }
    },
    email_metrics: {
      total_sent: parseInt(stats.total_emails_sent),
      delivered: parseInt(stats.emails_delivered),
      failed: parseInt(stats.emails_failed),
      delivery_rate: stats.total_emails_sent > 0 
        ? ((stats.emails_delivered / stats.total_emails_sent) * 100).toFixed(2) 
        : 0
    },
    top_countries: countriesResult.rows,
    top_companies: companiesResult.rows,
    registration_sources: sourcesResult.rows,
    daily_trend: trendResult.rows,
    hourly_distribution: hourlyResult.rows
  };

  // Add detailed data if requested
  if (includeDetails) {
    // Recent registrations
    const recentQuery = `
      SELECT 
        id,
        qr_code,
        custom_fields->>'name' as name,
        custom_fields->>'last_name' as last_name,
        custom_fields->>'email' as email,
        COALESCE(NULLIF(custom_fields->>'company', ''), company) as company,
        COALESCE(NULLIF(custom_fields->>'country', ''), country) as country,
        source,
        created_at
      FROM visitors
      WHERE expo_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `;
    const recentResult = await pool.query(recentQuery, [expoId]);

    // Recent check-ins
    const recentCheckinsQuery = `
      SELECT 
        c.checkin_time,
        c.terminal,
        c.hall,
        v.custom_fields->>'name' as visitor_name,
        v.COALESCE(NULLIF(custom_fields->>'company', ''), company) as company
      FROM checkins c
      JOIN visitors v ON c.visitor_id = v.id
      WHERE c.expo_id = $1
      ORDER BY c.checkin_time DESC
      LIMIT 20
    `;
    const recentCheckinsResult = await pool.query(recentCheckinsQuery, [expoId]);

    report.recent_activity = {
      recent_registrations: recentResult.rows,
      recent_checkins: recentCheckinsResult.rows
    };
  }

  return report;
}

/**
 * Generate report for entire organizer
 */
async function generateOrganizerReport(organizerId, startDate, endDate, includeDetails) {
  // Build date filter
  let dateFilter = '';
  const params = [organizerId];
  let paramCount = 2;

  if (startDate) {
    dateFilter += ` AND created_at >= $${paramCount}`;
    params.push(startDate);
    paramCount++;
  }
  if (endDate) {
    dateFilter += ` AND created_at <= $${paramCount}`;
    params.push(endDate);
    paramCount++;
  }

  // Main statistics query
  const statsQuery = `
    WITH expo_stats AS (
      SELECT 
        COUNT(*) as total_expos,
        COUNT(CASE WHEN start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE THEN 1 END) as active_expos,
        COUNT(CASE WHEN start_date > CURRENT_DATE THEN 1 END) as upcoming_expos,
        COUNT(CASE WHEN end_date < CURRENT_DATE THEN 1 END) as past_expos
      FROM expos
      WHERE organizer_id = $1
    ),
    visitor_stats AS (
      SELECT 
        COUNT(*) as total_visitors,
        COUNT(DISTINCT COALESCE(NULLIF(custom_fields->>'email', ''), email)) as unique_emails,
        COUNT(DISTINCT COALESCE(NULLIF(custom_fields->>'company', ''), company)) as unique_companies,
        COUNT(DISTINCT COALESCE(NULLIF(custom_fields->>'country', ''), country)) as unique_countries,
        COUNT(DISTINCT expo_id) as expos_with_visitors,
        COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as registrations_today,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as registrations_week,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as registrations_month
      FROM visitors
      WHERE organizer_id = $1 ${dateFilter}
    ),
    checkin_stats AS (
      SELECT 
        COUNT(*) as total_checkins,
        COUNT(DISTINCT c.visitor_id) as unique_visitors_checked_in,
        COUNT(CASE WHEN c.checkin_time >= CURRENT_DATE THEN 1 END) as checkins_today,
        COUNT(DISTINCT c.expo_id) as expos_with_checkins
      FROM checkins c
      JOIN visitors v ON c.visitor_id = v.id
      WHERE v.organizer_id = $1
    ),
    email_stats AS (
      SELECT 
        COUNT(*) as total_emails_sent,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as emails_delivered,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as emails_failed,
        COUNT(DISTINCT template_id) as templates_used
      FROM email_logs
      WHERE organizer_id = $1
    )
    SELECT 
      es.*,
      vs.*,
      cs.*,
      ems.*,
      CASE 
        WHEN vs.total_visitors > 0 
        THEN (cs.unique_visitors_checked_in::float / vs.total_visitors * 100)::numeric(5,2)
        ELSE 0 
      END as overall_checkin_rate
    FROM expo_stats es, visitor_stats vs, checkin_stats cs, email_stats ems
  `;

  const statsResult = await pool.query(statsQuery, params);
  const stats = statsResult.rows[0];

  // Expo performance
  const expoPerformanceQuery = `
    SELECT 
      e.id,
      e.name,
      e.start_date,
      e.end_date,
      COUNT(DISTINCT v.id) as visitors,
      COUNT(DISTINCT c.visitor_id) as checked_in,
      CASE 
        WHEN COUNT(v.id) > 0 
        THEN (COUNT(DISTINCT c.visitor_id)::float / COUNT(DISTINCT v.id) * 100)::numeric(5,2)
        ELSE 0 
      END as checkin_rate
    FROM expos e
    LEFT JOIN visitors v ON e.id = v.expo_id
    LEFT JOIN checkins c ON v.id = c.visitor_id
    WHERE e.organizer_id = $1
    GROUP BY e.id, e.name, e.start_date, e.end_date
    ORDER BY e.start_date DESC
  `;
  const expoPerformanceResult = await pool.query(expoPerformanceQuery, [organizerId]);

  // Top countries across all expos
  const countriesQuery = `
    SELECT 
      COALESCE(NULLIF(custom_fields->>'country', ''), country) as country,
      COUNT(*) as count,
      COUNT(DISTINCT expo_id) as expo_count,
      ROUND((COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM visitors WHERE organizer_id = $1), 0)), 2) as percentage
    FROM visitors
    WHERE organizer_id = $1 
    AND COALESCE(NULLIF(custom_fields->>'country', ''), country) IS NOT NULL
    ${dateFilter}
    GROUP BY COALESCE(NULLIF(custom_fields->>'country', ''), country)
    ORDER BY count DESC
    LIMIT 15
  `;
  const countriesResult = await pool.query(countriesQuery, params);

  // Top companies across all expos
  const companiesQuery = `
    SELECT 
      COALESCE(NULLIF(custom_fields->>'company', ''), company) as company,
      COUNT(*) as count,
      COUNT(DISTINCT expo_id) as expo_count,
      COUNT(DISTINCT COALESCE(NULLIF(custom_fields->>'email', ''), email)) as unique_visitors
    FROM visitors
    WHERE organizer_id = $1 
    AND COALESCE(NULLIF(custom_fields->>'company', ''), company) IS NOT NULL
    ${dateFilter}
    GROUP BY COALESCE(NULLIF(custom_fields->>'company', ''), company)
    ORDER BY count DESC
    LIMIT 15
  `;
  const companiesResult = await pool.query(companiesQuery, params);

  // Registration sources across all expos
  const sourcesQuery = `
    SELECT 
      source,
      COUNT(*) as count,
      COUNT(DISTINCT expo_id) as expo_count,
      ROUND((COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM visitors WHERE organizer_id = $1), 0)), 2) as percentage
    FROM visitors
    WHERE organizer_id = $1
    ${dateFilter}
    GROUP BY source
    ORDER BY count DESC
  `;
  const sourcesResult = await pool.query(sourcesQuery, params);

  // Monthly trend (last 12 months)
  const monthlyTrendQuery = `
    SELECT 
      TO_CHAR(created_at, 'YYYY-MM') as month,
      COUNT(*) as registrations,
      COUNT(DISTINCT expo_id) as active_expos,
      COUNT(DISTINCT COALESCE(NULLIF(custom_fields->>'email', ''), email)) as unique_visitors
    FROM visitors
    WHERE organizer_id = $1
    AND created_at >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY TO_CHAR(created_at, 'YYYY-MM')
    ORDER BY month DESC
  `;
  const monthlyTrendResult = await pool.query(monthlyTrendQuery, [organizerId]);

  // Build report object
  const report = {
    expo_metrics: {
      total_expos: parseInt(stats.total_expos),
      active_expos: parseInt(stats.active_expos),
      upcoming_expos: parseInt(stats.upcoming_expos),
      past_expos: parseInt(stats.past_expos),
      expos_with_visitors: parseInt(stats.expos_with_visitors),
      expos_with_checkins: parseInt(stats.expos_with_checkins)
    },
    visitor_metrics: {
      total_visitors: parseInt(stats.total_visitors),
      unique_emails: parseInt(stats.unique_emails),
      unique_companies: parseInt(stats.unique_companies),
      unique_countries: parseInt(stats.unique_countries),
      registrations_today: parseInt(stats.registrations_today),
      registrations_week: parseInt(stats.registrations_week),
      registrations_month: parseInt(stats.registrations_month)
    },
    checkin_metrics: {
      total_checkins: parseInt(stats.total_checkins),
      unique_visitors_checked_in: parseInt(stats.unique_visitors_checked_in),
      overall_checkin_rate: parseFloat(stats.overall_checkin_rate),
      checkins_today: parseInt(stats.checkins_today)
    },
    email_metrics: {
      total_sent: parseInt(stats.total_emails_sent),
      delivered: parseInt(stats.emails_delivered),
      failed: parseInt(stats.emails_failed),
      templates_used: parseInt(stats.templates_used),
      delivery_rate: stats.total_emails_sent > 0 
        ? ((stats.emails_delivered / stats.total_emails_sent) * 100).toFixed(2) 
        : 0
    },
    expo_performance: expoPerformanceResult.rows,
    top_countries: countriesResult.rows,
    top_companies: companiesResult.rows,
    registration_sources: sourcesResult.rows,
    monthly_trend: monthlyTrendResult.rows
  };

  // Add detailed data if requested
  if (includeDetails) {
    // Recent activity across all expos
    const recentActivityQuery = `
      SELECT 
        'registration' as type,
        v.created_at as timestamp,
        e.name as expo_name,
        v.custom_fields->>'name' as visitor_name,
        v.custom_fields->>'email' as email,
        v.COALESCE(NULLIF(custom_fields->>'company', ''), company) as company
      FROM visitors v
      JOIN expos e ON v.expo_id = e.id
      WHERE v.organizer_id = $1
      ORDER BY v.created_at DESC
      LIMIT 10
    `;
    const recentActivityResult = await pool.query(recentActivityQuery, [organizerId]);

    // Template performance
    const templatePerformanceQuery = `
      SELECT 
        et.name as template_name,
        et.template_type,
        COUNT(el.id) as times_used,
        COUNT(CASE WHEN el.status = 'sent' THEN 1 END) as successful_sends,
        MAX(el.sent_at) as last_used
      FROM email_templates et
      LEFT JOIN email_logs el ON et.id = el.template_id
      WHERE et.organizer_id = $1
      GROUP BY et.id, et.name, et.template_type
      ORDER BY times_used DESC
      LIMIT 10
    `;
    const templatePerformanceResult = await pool.query(templatePerformanceQuery, [organizerId]);

    report.detailed_insights = {
      recent_activity: recentActivityResult.rows,
      template_performance: templatePerformanceResult.rows
    };
  }

  return report;
}

/**
 * GET /api/reports/export
 * Export report data in various formats
 */
router.get('/export', authenticateToken, async (req, res) => {
  const { expo_id, format = 'json', start_date, end_date } = req.query;

  try {
    // Generate report data
    let reportData;
    if (expo_id) {
      // Verify ownership
      const expoCheck = await pool.query(
        'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
        [expo_id, req.organizer_id]
      );

      if (expoCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied to this expo' });
      }

      reportData = await generateExpoReport(expo_id, start_date, end_date, true);
    } else {
      reportData = await generateOrganizerReport(req.organizer_id, start_date, end_date, true);
    }

    // Format response based on requested format
    if (format === 'json') {
      res.json(reportData);
    } else if (format === 'csv') {
      // Convert to CSV format (simplified version)
      const csv = convertReportToCSV(reportData);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="report_${Date.now()}.csv"`);
      res.send(csv);
    } else {
      res.status(400).json({ error: 'Invalid format. Use json or csv' });
    }
  } catch (err) {
    console.error('Error exporting report:', err);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

/**
 * GET /api/reports/comparison
 * Compare metrics between different time periods or expos
 */
router.get('/comparison', authenticateToken, async (req, res) => {
  const { expo_ids, period_1_start, period_1_end, period_2_start, period_2_end } = req.query;

  try {
    let comparisonData = {};

    if (expo_ids) {
      // Compare multiple expos
      const expoIdArray = expo_ids.split(',').map(id => parseInt(id));
      
      // Verify ownership of all expos
      const ownershipCheck = await pool.query(
        'SELECT id, name FROM expos WHERE id = ANY($1::int[]) AND organizer_id = $2',
        [expoIdArray, req.organizer_id]
      );

      if (ownershipCheck.rows.length !== expoIdArray.length) {
        return res.status(403).json({ error: 'Access denied to one or more expos' });
      }

      // Generate comparison data for each expo
      const comparisons = [];
      for (const expoId of expoIdArray) {
        const expoData = await generateExpoReport(expoId, null, null, false);
        const expoInfo = ownershipCheck.rows.find(e => e.id === expoId);
        comparisons.push({
          expo_id: expoId,
          expo_name: expoInfo.name,
          metrics: expoData
        });
      }

      comparisonData = {
        type: 'expo_comparison',
        data: comparisons
      };
    } else if (period_1_start && period_2_start) {
      // Compare time periods
      const period1 = await generateOrganizerReport(req.organizer_id, period_1_start, period_1_end, false);
      const period2 = await generateOrganizerReport(req.organizer_id, period_2_start, period_2_end, false);

      comparisonData = {
        type: 'period_comparison',
        period_1: {
          start: period_1_start,
          end: period_1_end || 'now',
          metrics: period1
        },
        period_2: {
          start: period_2_start,
          end: period_2_end || 'now',
          metrics: period2
        },
        growth_metrics: calculateGrowthMetrics(period1, period2)
      };
    } else {
      return res.status(400).json({ 
        error: 'Provide either expo_ids for expo comparison or period dates for time comparison' 
      });
    }

    res.json(comparisonData);
  } catch (err) {
    console.error('Error generating comparison:', err);
    res.status(500).json({ error: 'Failed to generate comparison' });
  }
});

/**
 * Helper function to convert report to CSV
 */
function convertReportToCSV(reportData) {
  const lines = [];
  
  // Add headers and basic metrics
  lines.push('Metric,Value');
  
  // Flatten the report structure for CSV
  if (reportData.visitor_metrics) {
    Object.entries(reportData.visitor_metrics).forEach(([key, value]) => {
      lines.push(`${key.replace(/_/g, ' ')},${value}`);
    });
  }
  
  if (reportData.checkin_metrics) {
    Object.entries(reportData.checkin_metrics).forEach(([key, value]) => {
      if (typeof value !== 'object') {
        lines.push(`${key.replace(/_/g, ' ')},${value}`);
      }
    });
  }

  // Add top countries
  if (reportData.top_countries && reportData.top_countries.length > 0) {
    lines.push('');
    lines.push('Top Countries,Count,Percentage');
    reportData.top_countries.forEach(country => {
      lines.push(`${country.country},${country.count},${country.percentage}%`);
    });
  }

  return lines.join('\n');
}

/**
 * Calculate growth metrics between two periods
 */
function calculateGrowthMetrics(period1, period2) {
  const metrics = {};

  // Calculate percentage changes for key metrics
  if (period1.visitor_metrics && period2.visitor_metrics) {
    const v1 = period1.visitor_metrics.total_visitors;
    const v2 = period2.visitor_metrics.total_visitors;
    metrics.visitor_growth = v1 > 0 ? ((v2 - v1) / v1 * 100).toFixed(2) : 0;
  }

  if (period1.checkin_metrics && period2.checkin_metrics) {
    const c1 = period1.checkin_metrics.total_checkins;
    const c2 = period2.checkin_metrics.total_checkins;
    metrics.checkin_growth = c1 > 0 ? ((c2 - c1) / c1 * 100).toFixed(2) : 0;
  }

  return metrics;
}

module.exports = router;
