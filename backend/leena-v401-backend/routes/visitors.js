// POST /api/visitors/public - Public visitor form submission (UPDATED)
router.post('/public', async (req, res) => {
    try {
        const {
            form_id,
            custom_fields = {}
        } = req.body;

        console.log('📝 Received public form submission:', { 
            form_id, 
            custom_fields: Object.keys(custom_fields) 
        });

        if (!form_id) {
            return res.status(400).json({
                success: false,
                message: 'Form ID is required'
            });
        }

        // Get form details including email template and visitor type
        const formQuery = `
            SELECT f.id, f.expo_id, f.organizer_id, f.is_active, f.name,
                   f.email_template_id, f.visitor_type, f.source, f.origin,
                   e.name as expo_name,
                   et.subject as email_subject,
                   et.html_content as email_html
            FROM forms f
            LEFT JOIN expos e ON e.id = f.expo_id
            LEFT JOIN email_templates et ON et.id = f.email_template_id
            WHERE f.id = $1 AND f.is_active = true
        `;
        const formResult = await pool.query(formQuery, [form_id]);
        
        if (formResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Form not found or inactive' 
            });
        }
        
        const form = formResult.rows[0];
        const expo_id = form.expo_id;
        const organizer_id = form.organizer_id;
        const visitor_type = form.visitor_type || 'visitor';
        const source = form.source || 'public_form';
        const origin = form.origin || 'form-public';
        
        console.log('✅ Form validated:', {
            form_id: form.id,
            form_name: form.name,
            expo_id: expo_id,
            expo_name: form.expo_name,
            organizer_id: organizer_id,
            visitor_type: visitor_type,
            email_template_id: form.email_template_id
        });

        if (!expo_id) {
            return res.status(400).json({
                success: false,
                message: 'This form is not associated with a specific expo. Please contact the organizer.'
            });
        }

        // Extract common fields
        const visitorName = custom_fields.full_name || custom_fields.name || 'Anonymous';
        const visitorEmail = custom_fields.email || null;
        const visitorPhone = custom_fields.phone || custom_fields.tel || null;
        const visitorCompany = custom_fields.company || null;

        const badge_id = `BADGE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const qr_code = uuidv4();

        console.log(`📋 Creating ${visitor_type} with QR Code: ${qr_code} for expo: ${expo_id}`);

        let result;
        
        // Insert into appropriate table based on visitor_type
        if (visitor_type === 'exhibitor') {
            // Insert into exhibitors table
            result = await pool.query(
                `INSERT INTO exhibitors (
                    name, email, phone, company, form_id, expo_id,
                    badge_id, qr_code, source, origin, custom_fields, created_at,
                    organizer_id, booth_number
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10, $11, NOW(),
                    $12, $13
                )
                RETURNING id, name, email, badge_id, qr_code, created_at`,
                [
                    visitorName,
                    visitorEmail,
                    visitorPhone,
                    visitorCompany,
                    form_id,
                    expo_id,
                    badge_id,
                    qr_code,
                    source,
                    origin,
                    JSON.stringify(custom_fields),
                    organizer_id,
                    custom_fields.booth_number || null
                ]
            );
            console.log(`✅ Exhibitor registered: ${result.rows[0].id} for expo ${expo_id}`);
        } else {
            // Insert into visitors table (default)
            result = await pool.query(
                `INSERT INTO visitors (
                    name, email, phone, company, form_id, expo_id,
                    badge_id, qr_code, source, origin, custom_fields, created_at,
                    organizer_id
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10, $11, NOW(),
                    $12
                )
                RETURNING id, name, email, badge_id, qr_code, created_at`,
                [
                    visitorName,
                    visitorEmail,
                    visitorPhone,
                    visitorCompany,
                    form_id,
                    expo_id,
                    badge_id,
                    qr_code,
                    source,
                    origin,
                    JSON.stringify(custom_fields),
                    organizer_id
                ]
            );
            console.log(`✅ Visitor registered: ${result.rows[0].id} for expo ${expo_id}`);
        }

        const registrant = result.rows[0];

        // Send email if template is configured and email is available
        if (visitorEmail && form.email_template_id && form.email_html) {
            setImmediate(async () => {
                try {
                    // Generate QR code
                    const qrCodeDataUrl = await generateQRCode(qr_code);
                    const badgeUrl = generateBadgeUrl(qr_code);
                    
                    // Prepare email data
                    const emailData = {
                        name: visitorName,
                        email: visitorEmail,
                        company: visitorCompany || '',
                        phone: visitorPhone || '',
                        expo_name: form.expo_name || '',
                        badge_id: badge_id,
                        qr_code: qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code" style="max-width: 200px;">` : '',
                        badge_url: badgeUrl,
                        date: new Date().toLocaleDateString(),
                        // Add all custom fields as well
                        ...custom_fields
                    };
                    
                    // Process email template
                    let emailHtml = form.email_html;
                    let emailSubject = form.email_subject || 'Registration Confirmation';
                    
                    // Replace placeholders
                    Object.keys(emailData).forEach(key => {
                        const regex = new RegExp(`{{${key}}}|\\[${key}\\]`, 'gi');
                        emailHtml = emailHtml.replace(regex, emailData[key] || '');
                        emailSubject = emailSubject.replace(regex, emailData[key] || '');
                    });
                    
                    // Send email using your email utility
                    const sent = await sendEmail(visitorEmail, emailSubject, emailHtml);
                    
                    if (sent) {
                        console.log(`📧 Email sent to ${visitorEmail} using template ${form.email_template_id}`);
                        
                        // Log email sending
                        await pool.query(
                            `INSERT INTO email_logs (
                                organizer_id, template_id, expo_id, 
                                recipient_email, recipient_name, subject, 
                                status, visitor_id, created_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                            [
                                organizer_id,
                                form.email_template_id,
                                expo_id,
                                visitorEmail,
                                visitorName,
                                emailSubject,
                                'sent',
                                registrant.id
                            ]
                        );
                    } else {
                        console.log(`⚠️ Email not sent to ${visitorEmail}`);
                    }
                } catch (err) {
                    console.error('❌ Error sending email:', err);
                }
            });
        }

        res.status(201).json({
            success: true,
            message: 'Registration successful! Your badge ID is: ' + badge_id,
            visitor: {
                id: registrant.id,
                name: registrant.name,
                email: registrant.email,
                badge_id: registrant.badge_id,
                qr_code: registrant.qr_code,
                badge_url: `http://localhost:3000/badge-print.html?qr=${registrant.qr_code}`,
                type: visitor_type
            }
        });
    } catch (error) {
        console.error('Error in public form submission:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to register',
            error: error.message
        });
    }
});
