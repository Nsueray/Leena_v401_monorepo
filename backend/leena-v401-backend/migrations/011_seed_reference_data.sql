-- ============================================================
-- 011 — Reference data seed: core_countries + core_sectors
-- Fills the two reference tables created in migration 010.
-- Idempotent: ON CONFLICT DO NOTHING — safe to re-run.
-- Country codes = ISO-3166-1 alpha-2 (CHAR(2)), match expos.country_code.
-- ============================================================

BEGIN;

-- ---------- core_sectors (27) ----------
INSERT INTO core_sectors (slug, name) VALUES
  ('association_federation', 'Association / Federation'),
  ('automotive',             'Automotive'),
  ('construction',           'Construction'),
  ('cosmetics',              'Cosmetics'),
  ('decoration_furniture',   'Decoration / Furniture'),
  ('electricity',            'Electricity'),
  ('energy',                 'Energy'),
  ('fashion_textile',        'Fashion / Textile'),
  ('food_agriculture',       'Food / Agriculture'),
  ('general_trade',          'General Trade'),
  ('home_textile',           'Home Textile'),
  ('horeca',                 'Horeca'),
  ('hvac',                   'HVAC'),
  ('information_technology',  'Information Technology'),
  ('jewelry',                'Jewelry'),
  ('led_sign_lighting',      'Led / Sign / Lighting'),
  ('logistics',              'Logistics'),
  ('medical',                'Medical'),
  ('mother_children_baby',   'Mother / Children / Baby'),
  ('organizer_trade_shows',  'Organizer / Trade Shows / Fair Ground'),
  ('other',                  'Other'),
  ('real_estate',            'Real Estate'),
  ('tourism',                'Tourism'),
  ('urban_flower',           'Urban / Flower'),
  ('water_systems',          'Water Systems'),
  ('wedding',                'Wedding')
ON CONFLICT (slug) DO NOTHING;

-- ---------- core_countries (ISO-3166-1 alpha-2, full) ----------
INSERT INTO core_countries (code, name) VALUES
  ('AF','Afghanistan'),('AX','Aland Islands'),('AL','Albania'),('DZ','Algeria'),
  ('AS','American Samoa'),('AD','Andorra'),('AO','Angola'),('AI','Anguilla'),
  ('AG','Antigua and Barbuda'),('AR','Argentina'),('AM','Armenia'),('AW','Aruba'),
  ('AU','Australia'),('AT','Austria'),('AZ','Azerbaijan'),('BS','Bahamas'),
  ('BH','Bahrain'),('BD','Bangladesh'),('BB','Barbados'),('BY','Belarus'),
  ('BE','Belgium'),('BZ','Belize'),('BJ','Benin'),('BM','Bermuda'),
  ('BT','Bhutan'),('BO','Bolivia'),('BA','Bosnia and Herzegovina'),('BW','Botswana'),
  ('BR','Brazil'),('BN','Brunei'),('BG','Bulgaria'),('BF','Burkina Faso'),
  ('BI','Burundi'),('CV','Cabo Verde'),('KH','Cambodia'),('CM','Cameroon'),
  ('CA','Canada'),('KY','Cayman Islands'),('CF','Central African Republic'),('TD','Chad'),
  ('CL','Chile'),('CN','China'),('CO','Colombia'),('KM','Comoros'),
  ('CG','Congo'),('CD','Congo (DRC)'),('CK','Cook Islands'),('CR','Costa Rica'),
  ('CI','Cote d''Ivoire'),('HR','Croatia'),('CU','Cuba'),('CW','Curacao'),
  ('CY','Cyprus'),('CZ','Czechia'),('DK','Denmark'),('DJ','Djibouti'),
  ('DM','Dominica'),('DO','Dominican Republic'),('EC','Ecuador'),('EG','Egypt'),
  ('SV','El Salvador'),('GQ','Equatorial Guinea'),('ER','Eritrea'),('EE','Estonia'),
  ('SZ','Eswatini'),('ET','Ethiopia'),('FO','Faroe Islands'),('FJ','Fiji'),
  ('FI','Finland'),('FR','France'),('GF','French Guiana'),('PF','French Polynesia'),
  ('GA','Gabon'),('GM','Gambia'),('GE','Georgia'),('DE','Germany'),
  ('GH','Ghana'),('GI','Gibraltar'),('GR','Greece'),('GL','Greenland'),
  ('GD','Grenada'),('GP','Guadeloupe'),('GU','Guam'),('GT','Guatemala'),
  ('GG','Guernsey'),('GN','Guinea'),('GW','Guinea-Bissau'),('GY','Guyana'),
  ('HT','Haiti'),('HN','Honduras'),('HK','Hong Kong'),('HU','Hungary'),
  ('IS','Iceland'),('IN','India'),('ID','Indonesia'),('IR','Iran'),
  ('IQ','Iraq'),('IE','Ireland'),('IM','Isle of Man'),('IL','Israel'),
  ('IT','Italy'),('JM','Jamaica'),('JP','Japan'),('JE','Jersey'),
  ('JO','Jordan'),('KZ','Kazakhstan'),('KE','Kenya'),('KI','Kiribati'),
  ('KP','Korea (North)'),('KR','Korea (South)'),('KW','Kuwait'),('KG','Kyrgyzstan'),
  ('LA','Laos'),('LV','Latvia'),('LB','Lebanon'),('LS','Lesotho'),
  ('LR','Liberia'),('LY','Libya'),('LI','Liechtenstein'),('LT','Lithuania'),
  ('LU','Luxembourg'),('MO','Macao'),('MG','Madagascar'),('MW','Malawi'),
  ('MY','Malaysia'),('MV','Maldives'),('ML','Mali'),('MT','Malta'),
  ('MH','Marshall Islands'),('MQ','Martinique'),('MR','Mauritania'),('MU','Mauritius'),
  ('YT','Mayotte'),('MX','Mexico'),('FM','Micronesia'),('MD','Moldova'),
  ('MC','Monaco'),('MN','Mongolia'),('ME','Montenegro'),('MS','Montserrat'),
  ('MA','Morocco'),('MZ','Mozambique'),('MM','Myanmar'),('NA','Namibia'),
  ('NR','Nauru'),('NP','Nepal'),('NL','Netherlands'),('NC','New Caledonia'),
  ('NZ','New Zealand'),('NI','Nicaragua'),('NE','Niger'),('NG','Nigeria'),
  ('NU','Niue'),('MK','North Macedonia'),('MP','Northern Mariana Islands'),('NO','Norway'),
  ('OM','Oman'),('PK','Pakistan'),('PW','Palau'),('PS','Palestine'),
  ('PA','Panama'),('PG','Papua New Guinea'),('PY','Paraguay'),('PE','Peru'),
  ('PH','Philippines'),('PL','Poland'),('PT','Portugal'),('PR','Puerto Rico'),
  ('QA','Qatar'),('RE','Reunion'),('RO','Romania'),('RU','Russia'),
  ('RW','Rwanda'),('BL','Saint Barthelemy'),('KN','Saint Kitts and Nevis'),('LC','Saint Lucia'),
  ('MF','Saint Martin'),('VC','Saint Vincent and the Grenadines'),('WS','Samoa'),('SM','San Marino'),
  ('ST','Sao Tome and Principe'),('SA','Saudi Arabia'),('SN','Senegal'),('RS','Serbia'),
  ('SC','Seychelles'),('SL','Sierra Leone'),('SG','Singapore'),('SX','Sint Maarten'),
  ('SK','Slovakia'),('SI','Slovenia'),('SB','Solomon Islands'),('SO','Somalia'),
  ('ZA','South Africa'),('SS','South Sudan'),('ES','Spain'),('LK','Sri Lanka'),
  ('SD','Sudan'),('SR','Suriname'),('SE','Sweden'),('CH','Switzerland'),
  ('SY','Syria'),('TW','Taiwan'),('TJ','Tajikistan'),('TZ','Tanzania'),
  ('TH','Thailand'),('TL','Timor-Leste'),('TG','Togo'),('TO','Tonga'),
  ('TT','Trinidad and Tobago'),('TN','Tunisia'),('TR','Turkey'),('TM','Turkmenistan'),
  ('TC','Turks and Caicos Islands'),('TV','Tuvalu'),('UG','Uganda'),('UA','Ukraine'),
  ('AE','United Arab Emirates'),('GB','United Kingdom'),('US','United States'),('UY','Uruguay'),
  ('UZ','Uzbekistan'),('VU','Vanuatu'),('VA','Vatican City'),('VE','Venezuela'),
  ('VN','Vietnam'),('VG','Virgin Islands (British)'),('VI','Virgin Islands (US)'),('YE','Yemen'),
  ('ZM','Zambia'),('ZW','Zimbabwe')
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- Verify counts after running:
--   SELECT count(*) AS sectors FROM core_sectors;    -- expect 26
--   SELECT count(*) AS countries FROM core_countries; -- expect ~210
