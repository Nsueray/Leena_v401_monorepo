# ELL Floor Plan Builder — Final Mimari Spesifikasyon v2.1

**Modül:** Floor Plan Builder (LEENA Extension, ELL Platform)  
**Versiyon:** v2.1 — Final (Onaylanmış)  
**Tarih:** 2026-03-30  
**Sahibi:** Elan Expo / Suer Ay  
**Girdiler:** Claude (mimari spec v1 + v2 + v2.1), ChatGPT (domain analizi + sertleştirme kuralları), Gemini (teknik + veri modeli eleştirisi + onay), Suer (UX kararları + domain bilgisi)  
**Durum:** Geliştirmeye hazır — tüm AI reviewer'lar tarafından onaylanmıştır

---

## 0. Tanımlayıcı Cümle

> **Floor Plan Builder, LEENA içinde çalışan bir operasyon arayüzüdür; ancak veri modeli ELL ortak domain yapısına göre tasarlanır ve LİFFY contracts/companies ile native bağlantılı olur. ELIZA bu veriyi read-only analiz katmanı olarak kullanır.**

Bu modül bir "çizim aracı" değildir. **Data-driven spatial CRM layer**'dır.

### Mimari Değişmezler (Architectural Invariants)

Bu kurallar tüm fazlarda geçerlidir ve ihlal edilemez:

1. **Tek aktif versiyon kuralı:** Bir hall'da aynı anda yalnızca bir `expo_floorplan_versions` kaydı `status='active'` olabilir.

2. **Active versiyon koruması:** Active versiyonlar yapısal düzenlemeler (stand ekleme/silme/bölme/birleştirme, hücre değişikliği) için read-only'dir. Değişiklik gerekiyorsa: clone → yeni draft → düzenle → activate. Ticari güncellemeler (statü değişikliği, firma atama) active versiyon üzerinde yapılabilir.

3. **Hücre sahipliği garantisi:** Aynı floorplan versiyonu içinde bir grid hücresi (x,y) yalnızca bir standa ait olabilir. Bu kural veritabanı seviyesinde `UNIQUE` constraint ile enforce edilir.

4. **Alan hesaplama bütünlüğü:** `expo_stands.size_m2` değeri her zaman ilgili `expo_stand_cells` sayısından türetilir. Bu senkronizasyon PostgreSQL trigger ile sağlanır; uygulama katmanına bırakılmaz.

5. **LİFFY FK hedefleri:** `company_id` ve `contract_id` alanlarının FK hedef tabloları, LİFFY canonical company/contract tabloları kesinleştiğinde belirlenir. Bu tarihe kadar bu alanlar nullable INTEGER olarak kalır, FK constraint eklenmez.

6. **Özel alan kimliği:** `area_kind='special'` olan kayıtlar için `stand_code` alanı zorunludur ve alan tipini yansıtır (örn: "VIP", "CONF", "REG", "ENT-1"). `display_label` ise grid üzerinde gösterilen okunabilir isimdir (örn: "VIP Lounge", "Conference Area").

---

## 1. Problem & Neden Şimdi

### Mevcut Durum

Elan Expo'nun proje ekibi fuar kat planlarını **CorelDRAW** ile çiziyor:

- 1m² grid sistemi, standlar elle yerleştirilir
- Satış verisiyle bağlantı yok — bir stand satıldığında plan manuel güncellenir
- Versiyon kontrolü yok — "en son hangi pdf gitmişti?" sorusu cevapsız
- Rapor üretilemiyor — "yüzde kaçı satıldı?" CorelDRAW'dan okunamaz
- Satış hızına yetişemiyor — her değişiklik Yaprak'a bağımlı

### Neden Bu Modül İlk

1. **Proje ekibi (Yaprak) en hızlı adapte olacak** — küçük ekip, dijital araçlara açık
2. **Düşük risk** — mevcut Leena EMS visitor/checkin akışına dokunmaz
3. **Yüksek görünürlük** — ilk günden somut, görsel çıktı
4. **LİFFY temeli** — Faz 1'de sözleşme-stand eşleştirmesi bu altyapıya oturur
5. **ELL tasarım dilinin ilk showcase'i** — ELIZA dashboard çizgisinde yeni UI

---

## 2. Referans Analizi: Mega Clima Nigeria 2026

Ekteki kat planından çıkarılan yapı:

### Fiziksel Yapı

- **Hall 1** — Landmark Centre, Lagos
- **Brüt alan:** 1.074 m² | **Satılabilir net:** 894 m²
- **Bölgeler:** A, B, C, D, E (mantıksal gruplandırma)
- **Stand boyutları:** 9, 12, 15, 18, 24, 30, 36, 42, 54, 66 m²
- **Özel alanlar:** VIP (8×10), Conference (10×12), Registration Desk, Entrance/Exit

### Kritik Gözlem: İki Katman

1. **Physical Layer** — Grid, geometri, koridorlar, özel alanlar
2. **Commercial Layer** — Firma atamaları, statüler, sözleşme bağları

Bu iki katman bugün birbirinden kopuk. Floor Plan Builder bu ikisini birleştirir.

---

## 3. Temel UX Kararı (Suer Onayı)

### Stand Oluşturma Yöntemi: Cell Selection

Kullanıcı **grid üzerinde kutucukları seçerek** stand oluşturur:

```
Örnek: 9m² stand oluşturma

Grid üzerinde 3×3 kutucuk seç:
┌───┬───┬───┐
│ ■ │ ■ │ ■ │
├───┼───┼───┤
│ ■ │ ■ │ ■ │  → "Stand Oluştur" → A1 (9m²)
├───┼───┼───┤
│ ■ │ ■ │ ■ │
└───┴───┴───┘

Veya L-şekilli stand:
┌───┬───┬───┐
│ ■ │ ■ │ ■ │
├───┼───┼───┤
│ ■ │   │   │  → "Stand Oluştur" → B7 (5m²)
├───┼───┼───┤
│ ■ │   │   │
└───┴───┴───┘
```

**Koridorlar:** Stand olarak seçilmeyen her hücre otomatik olarak koridordur. Ayrı "koridor çizme" aracı gerekmez.

**Standlar bölünebilir:** Satış sürecinde 66m²'lik bir stand 36+30 olarak ikiye bölünebilir veya birden fazla küçük stand birleştirilebilir. Bu sürekli olur — satış sonuçlanana kadar plan değişir.

---

## 4. Sahiplik Modeli (ELL İçinde)

| Katman | Sahip | Açıklama |
|--------|-------|----------|
| **UI** | LEENA | Ekran, route, operasyon arayüzü |
| **Ticari bağ** | LİFFY | Company, contract FK'ları |
| **Analiz** | ELIZA | Read-only sorgu, metrikler |
| **Veri** | ELL ortak PostgreSQL | Tek veritabanı, ortak domain |

**Kural:** UI bağımsız olabilir, veri bağımsız olmamalı.

---

## 5. Kullanıcı Rolleri & Erişim

| Rol | Yapabilir | Yapamaz |
|-----|-----------|---------|
| **Proje Ekibi (Yaprak)** | Hall oluştur, grid tanımla, standları çiz/böl/birleştir, özel alan tanımla, firma ata, versiyon yönet, PDF export, plan kopyala | Sözleşme oluşturma (LİFFY) |
| **Satış Yöneticisi** | Planı görüntüle (read-only), boş standları filtrele, müşteriye link/PDF gönder, doluluk göster | Stand düzenleme |
| **CEO / ELIZA** | Doluluk metrikleri, boş alan analizi, satış hızı sorguları | Doğrudan düzenleme |
| **Müşteri (Gelecek)** | Kendi stand lokasyonunu gör | Herhangi düzenleme |

---

## 6. Veri Modeli (Revize — v2.0)

### Tasarım Prensipleri

- **Cell-based geometry** — her stand, sahip olduğu hücrelerin listesiyle tanımlanır
- **Versiyonlama** — aynı hall'ın birden fazla plan versiyonu olabilir
- **İki katmanlı statü** — area_kind (ne olduğu) + commercial_status (ticari durumu)
- **LİFFY-ready nullable FK'lar** — baştan hazır, MVP'de boş kalır
- **Tablo isimlendirme:** `expo_` prefix ile düzenli (schema ayırmak erken)
- **Audit trail:** created_by, updated_by alanları baştan var

### Tablolar

```sql
-- ============================================================
-- HALL: Fiziksel salon tanımı
-- ============================================================
CREATE TABLE expo_halls (
    id SERIAL PRIMARY KEY,
    expo_id INTEGER NOT NULL REFERENCES expos(id),
    name VARCHAR(100) NOT NULL,               -- "Hall 1", "Pavilion A", "Outdoor"
    grid_width INTEGER NOT NULL,              -- Grid genişliği (hücre sayısı = metre)
    grid_height INTEGER NOT NULL,             -- Grid yüksekliği (hücre sayısı = metre)
    cell_size_m2 NUMERIC(4,2) DEFAULT 1.0,    -- Hücre boyutu (varsayılan 1m²)
    total_area_sqm NUMERIC(10,2) GENERATED ALWAYS AS 
        (grid_width * grid_height * cell_size_m2) STORED,
    metadata JSONB DEFAULT '{}',              -- Venue bilgisi, notlar
    created_by INTEGER,                       -- User ID
    updated_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FLOORPLAN VERSION: Aynı hall'ın farklı plan versiyonları
-- ============================================================
-- Neden gerekli:
--   - Satış öncesi draft
--   - Revize versiyon  
--   - Müşteriye gönderilen versiyon
--   - Baskıya giden final
--   - "Hangi PDF hangi planın çıktısıydı?" sorusunu yanıtlar
-- ============================================================
CREATE TABLE expo_floorplan_versions (
    id SERIAL PRIMARY KEY,
    hall_id INTEGER NOT NULL REFERENCES expo_halls(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,          -- 1, 2, 3...
    version_label VARCHAR(100),               -- "Draft", "Sales v2", "Final", "Post-show"
    status VARCHAR(20) DEFAULT 'draft',       -- draft, active, archived
    notes TEXT,                               -- Versiyon notları
    cloned_from_version_id INTEGER REFERENCES expo_floorplan_versions(id),
    created_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    activated_at TIMESTAMPTZ,                 -- active'e geçtiği an
    
    UNIQUE(hall_id, version_number)
);

-- ============================================================
-- STAND: Satılabilir alan birimi
-- ============================================================
-- Geometry: Cell-based — stand sahip olduğu hücrelerle tanımlanır
-- Statü: İki katmanlı — area_kind + commercial_status
-- LİFFY: nullable FK'lar baştan hazır
-- ============================================================
CREATE TABLE expo_stands (
    id SERIAL PRIMARY KEY,
    floorplan_version_id INTEGER NOT NULL 
        REFERENCES expo_floorplan_versions(id) ON DELETE CASCADE,
    
    -- Kimlik
    stand_code VARCHAR(20) NOT NULL,          -- "A1", "B3", "C4"
    zone VARCHAR(50),                         -- "A", "B", "C", "D", "E"
    display_label VARCHAR(255),               -- Grid üzerinde gösterilecek isim
    
    -- Alan tipi (ne olduğu — değişmez)
    area_kind VARCHAR(20) NOT NULL DEFAULT 'stand',
        -- stand: satılabilir stand
        -- special: özel alan (VIP, conference, reg desk)
        -- blocked: organizatör tarafından bloke
    special_area_type VARCHAR(50),            -- area_kind='special' ise: 
        -- vip, conference, registration, entrance, exit, technical, other
    
    -- Ticari durum (sadece area_kind='stand' için)
    commercial_status VARCHAR(30) DEFAULT 'available',
        -- available: satışa açık
        -- hold: geçici tutma (satışçı müşteriyle konuşuyor)
        -- reserved: opsiyon verilmiş
        -- pending_contract: teklif/sözleşme sürecinde
        -- sold: sözleşme imzalanmış
    
    -- Stand tipi
    stand_type VARCHAR(30) DEFAULT 'raw_space',
        -- raw_space, shell_scheme, island, corner, peninsula
    
    -- Hesaplanan alan (hücre sayısından, trigger ile senkron — Mimari Değişmez #4)
    size_m2 NUMERIC(10,2),                    -- PostgreSQL trigger ile expo_stand_cells COUNT'tan güncellenir
    
    -- Firma atama (MVP: text + nullable FK'lar)
    assigned_company_name VARCHAR(255),        -- MVP'de kullanılır
    company_id INTEGER,                       -- LİFFY FK (nullable, FK target TBD — Mimari Değişmez #5)
    contract_id INTEGER,                      -- LİFFY FK (nullable, FK target TBD — Mimari Değişmez #5)
    
    -- Rezervasyon bilgisi
    reservation_type VARCHAR(30),             -- verbal, written, deposit_paid
    reserved_by_user_id INTEGER,              -- Hangi satışçı reserve etti
    reserved_until TIMESTAMPTZ,               -- Opsiyon son tarihi
    
    -- Fiyat (opsiyonel)
    price_per_m2 NUMERIC(10,2),               -- Stand bazlı fiyat override
    
    -- Meta
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_by INTEGER,
    updated_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(floorplan_version_id, stand_code)
);

-- ============================================================
-- STAND CELLS: Hangi grid hücreleri bu standa ait
-- ============================================================
-- Her satır = 1 hücre (1m²)
-- Stand geometrisi = bu tablodaki hücrelerin toplamı
-- L-şekilli, düzensiz standları destekler
-- floorplan_version_id denormalize edilmiş: DB-level unique constraint için
-- ============================================================
CREATE TABLE expo_stand_cells (
    id SERIAL PRIMARY KEY,
    stand_id INTEGER NOT NULL REFERENCES expo_stands(id) ON DELETE CASCADE,
    floorplan_version_id INTEGER NOT NULL 
        REFERENCES expo_floorplan_versions(id),
    cell_x INTEGER NOT NULL,                  -- Grid X koordinatı (0-based)
    cell_y INTEGER NOT NULL,                  -- Grid Y koordinatı (0-based)
    
    UNIQUE(stand_id, cell_x, cell_y),
    -- KRITIK: Aynı hücre aynı versiyon içinde iki standa ait olamaz
    -- DB seviyesinde enforce edilir (Mimari Değişmez #3)
    UNIQUE(floorplan_version_id, cell_x, cell_y)
);

-- ============================================================
-- STAND ASSIGNMENT HISTORY (Faz 2)
-- ============================================================
-- MVP'de kullanılmaz — expo_stands.assigned_company_name yeterli
-- LİFFY entegrasyonunda aktif olur
-- Bir standın atama geçmişini tutar (bu yıl Firma A, geçen yıl Firma B)
-- ============================================================
CREATE TABLE expo_stand_assignments (
    id SERIAL PRIMARY KEY,
    stand_id INTEGER NOT NULL REFERENCES expo_stands(id) ON DELETE CASCADE,
    company_id INTEGER,                       -- LİFFY companies FK
    contract_id INTEGER,                      -- LİFFY contracts FK
    assigned_by INTEGER,                      -- User ID
    assignment_type VARCHAR(30),              -- reservation, sale, sponsor, organizer
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    released_at TIMESTAMPTZ,                  -- Atama kaldırıldığında
    notes TEXT
);

-- ============================================================
-- İNDEKSLER
-- ============================================================
CREATE INDEX idx_expo_halls_expo ON expo_halls(expo_id);
CREATE INDEX idx_expo_fpv_hall ON expo_floorplan_versions(hall_id);
CREATE INDEX idx_expo_fpv_status ON expo_floorplan_versions(status);
CREATE INDEX idx_expo_stands_fpv ON expo_stands(floorplan_version_id);
CREATE INDEX idx_expo_stands_status ON expo_stands(commercial_status);
CREATE INDEX idx_expo_stands_kind ON expo_stands(area_kind);
CREATE INDEX idx_expo_stand_cells_stand ON expo_stand_cells(stand_id);
CREATE INDEX idx_expo_stand_cells_pos ON expo_stand_cells(cell_x, cell_y);
CREATE INDEX idx_expo_stand_cells_version ON expo_stand_cells(floorplan_version_id);

-- ============================================================
-- CONSTRAINT: Bir hall'da aynı anda yalnızca 1 active versiyon
-- (Mimari Değişmez #1)
-- ============================================================
CREATE UNIQUE INDEX idx_one_active_version_per_hall 
    ON expo_floorplan_versions(hall_id) 
    WHERE status = 'active';

-- ============================================================
-- TRIGGER: size_m2 otomatik hesaplama (Mimari Değişmez #4)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_update_stand_size_m2()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE expo_stands 
    SET size_m2 = (
        SELECT COUNT(*) 
        FROM expo_stand_cells 
        WHERE stand_id = COALESCE(NEW.stand_id, OLD.stand_id)
    ),
    updated_at = NOW()
    WHERE id = COALESCE(NEW.stand_id, OLD.stand_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stand_size_after_cell_change
AFTER INSERT OR DELETE ON expo_stand_cells
FOR EACH ROW EXECUTE FUNCTION fn_update_stand_size_m2();
```

### İlişki Diagramı

```
expos (mevcut ELL master data)
  │
  └── 1:N → expo_halls
               │
               └── 1:N → expo_floorplan_versions
                            │
                            └── 1:N → expo_stands
                                       │
                                       ├── 1:N → expo_stand_cells (geometri)
                                       ├── assigned_company_name (MVP text)
                                       ├── company_id → [LİFFY companies] (nullable)
                                       ├── contract_id → [LİFFY contracts] (nullable)
                                       │
                                       └── 1:N → expo_stand_assignments (Faz 2, geçmiş)
```

### Geometry Notu

> İlk fazda tüm geometri cell-based (dikdörtgen + düzensiz şekiller, kutucuk seçimiyle). Gelecekte polygon/bezier desteği gerekirse `expo_stands.metadata` JSONB alanına `geometry_override` eklenerek genişletilir. Ama MVP'de ve muhtemelen uzun süre cell-based yeterlidir.

---

## 7. API Tasarımı

### Hall Endpoints

| Method | Endpoint | Auth | Açıklama |
|--------|----------|------|----------|
| GET | `/api/floorplan/halls?expo_id=X` | JWT | Expo'nun hall listesi |
| POST | `/api/floorplan/halls` | JWT | Yeni hall oluştur |
| PUT | `/api/floorplan/halls/:id` | JWT | Hall güncelle |
| DELETE | `/api/floorplan/halls/:id` | JWT | Hall sil (cascade) |

### Floorplan Version Endpoints

| Method | Endpoint | Auth | Açıklama |
|--------|----------|------|----------|
| GET | `/api/floorplan/halls/:hallId/versions` | JWT | Versiyon listesi |
| POST | `/api/floorplan/halls/:hallId/versions` | JWT | Yeni versiyon (draft) |
| PUT | `/api/floorplan/versions/:id` | JWT | Versiyon güncelle (label, status) |
| POST | `/api/floorplan/versions/:id/activate` | JWT | Versiyonu active yap |
| POST | `/api/floorplan/versions/:id/clone` | JWT | Versiyonu kopyala |

### Stand Endpoints

| Method | Endpoint | Auth | Açıklama |
|--------|----------|------|----------|
| GET | `/api/floorplan/versions/:versionId/stands` | JWT | Tüm standlar + cells |
| POST | `/api/floorplan/versions/:versionId/stands` | JWT | Stand oluştur (cells[] ile) |
| PUT | `/api/floorplan/stands/:id` | JWT | Stand güncelle |
| DELETE | `/api/floorplan/stands/:id` | JWT | Stand sil (cells cascade) |
| PUT | `/api/floorplan/stands/:id/assign` | JWT | Firma ata |
| PUT | `/api/floorplan/stands/:id/status` | JWT | Statü değiştir |
| POST | `/api/floorplan/stands/:id/split` | JWT | Standı böl |
| POST | `/api/floorplan/stands/merge` | JWT | Standları birleştir |

### Stats & Export

| Method | Endpoint | Auth | Açıklama |
|--------|----------|------|----------|
| GET | `/api/floorplan/versions/:versionId/stats` | JWT | Doluluk istatistikleri |
| GET | `/api/floorplan/halls/:hallId/stats` | JWT | Hall bazlı istatistikler |
| GET | `/api/floorplan/expo/:expoId/stats` | JWT | Expo bazlı kombine istatistikler |
| GET | `/api/floorplan/versions/:versionId/export/pdf` | JWT | PDF export |
| GET | `/api/floorplan/versions/:versionId/export/png` | JWT | PNG export |

---

## 8. Frontend Mimari

### Tasarım Dili

- Mevcut Leena EMS'den **bağımsız** CSS/tasarım
- **ELIZA Dashboard çizgisine yakın:** koyu tema, temiz tipografi, data-odaklı
- ELL platformunun yeni UI dilinin ilk örneği
- Desktop-first (editör), responsive görüntüleme (read-only)

### Sayfa Yapısı

```
┌──────────────────────────────────────────────────────────────┐
│  HEADER                                                      │
│  Expo: Mega Clima 2026  │ Hall: Hall 1  │ Version: Draft v2  │
│  [Export PDF] [Export PNG] [Clone] [Share Link]               │
├────────────────┬─────────────────────────────────────────────┤
│                │                                             │
│  SOL PANEL     │           CANVAS (Grid + Standlar)          │
│                │                                             │
│  ── Araçlar    │     ┌───┬───┬───────────┬───┐              │
│  [Select]      │     │A1 │A2 │           │   │              │
│  [Draw Stand]  │     │MIH│3W │    B3     │   │              │
│  [Special]     │     ├───┤SYS│  MANDILAS │   │              │
│  [Erase]       │     │A4 │   │  CARRIER  │   │              │
│                │     │ARA│   │   66m²    │   │              │
│  ── Filtreler  │     └───┴───┴───────────┴───┘              │
│  ☑ Available   │                                             │
│  ☑ Reserved    │     Seçilmeyen hücreler = koridor           │
│  ☑ Sold        │                                             │
│  ☑ Special     │                                             │
│                │                                             │
│  ── Stand      │                                             │
│  Detay         │                                             │
│  (seçili)      │                                             │
│  Code: A1      │                                             │
│  m²: 9         │                                             │
│  Status: Sold  │                                             │
│  Firma: MIHAMA │                                             │
│  [Böl] [Sil]   │                                             │
│                │                                             │
├────────────────┴─────────────────────────────────────────────┤
│  STATS BAR                                                    │
│  Brüt: 1074m² │ Net: 894m² │ Sold: 612m² (68%) │            │
│  Reserved: 90m² (10%) │ Available: 192m² (22%) │ 42 stands   │
└──────────────────────────────────────────────────────────────┘
```

### Canvas Teknolojisi: react-konva

**Karar:** react-konva (Canvas-based, Konva.js'in React wrapper'ı)

**Gerekçe:**

İlk spec'te SVG önermiştim. Ancak şu bilgiler kararı değiştirdi:

1. **Interaction-heavy editör** — Kullanıcı kutucukları tıklayıp seçiyor, sürüklüyor, resize ediyor, bölüyor, birleştiriyor. Bu düzenleme aracı, görüntüleme aracı değil.
2. **Zoom + pan + selection + snapping** — Tümü Canvas'ta daha performanslı
3. **Grid rendering** — 1000+ hücre (40×25 grid) + standlar + labels + hover efektleri
4. **Gelecek ihtiyaçlar** — Heatmap, highlight, canlı interaksiyon

SVG "ilk implementasyon rahatlığı" sağlar ama orta vadede sınır koyar. react-konva daha güçlü temel.

> **Performans notu (Gemini):** Grid çizgileri gibi sabit, etkileşimsiz arka plan elemanları için Konva'nın `cache()` özelliği kullanılmalı. Bu sayede zoom/pan ve sürükleme sırasında FPS maksimumda kalır. Export için `pixelRatio: 2` (veya daha yüksek) parametresi ile baskıya uygun yüksek çözünürlüklü çıktı alınabilir.

> **Dipnot:** Domain model ve workflow kesinleştikten sonra, implementasyon öncesinde küçük bir PoC (proof of concept) yapılarak react-konva kararı doğrulanmalı.

### PDF Export Stratejisi

**MVP:** Client-side high-res export (Canvas → PNG → PDF, html2canvas veya Konva.toDataURL)

**Faz 2:** Server-side branded export (Puppeteer), 3 varyant:
- Client PDF (temiz, branded — müşteriye gönderilir)
- Sales PDF (fiyat + m² bilgisiyle — satış ekibi kullanır)
- Operational PDF (detaylı grid — proje ekibi kullanır)

MVP'de Puppeteer gereksiz ağırlık. Client-side yeterli.

---

## 9. Statü Sistemi (İki Katmanlı)

### Katman 1: area_kind (Ne olduğu — yapısal)

| Değer | Açıklama | Satılabilir mi? |
|-------|----------|-----------------|
| `stand` | Satılabilir stand birimi | Evet |
| `special` | VIP, conference, registration, entrance vb. | Hayır |
| `blocked` | Organizatör tarafından bloke (teknik, yapısal) | Hayır |

### Katman 2: commercial_status (Ticari durum — sadece area_kind='stand')

| Değer | Renk | Açıklama |
|-------|------|----------|
| `available` | Beyaz/açık gri | Satışa açık |
| `hold` | Açık sarı | Satışçı geçici tuttu (müşteriyle konuşuyor) |
| `reserved` | Sarı/amber | Opsiyon verilmiş, vadeli |
| `pending_contract` | Turuncu | Teklif/sözleşme sürecinde |
| `sold` | Yeşil | Sözleşme imzalanmış |

### Özel Alan Renkleri

| special_area_type | Renk |
|-------------------|------|
| `vip` | Mor |
| `conference` | Mavi |
| `registration` | Koyu mavi |
| `entrance` / `exit` | Gri ok işareti |
| `technical` | Koyu gri |
| `blocked` | Kırmızı çizgili |

---

## 10. Temel Özellikler (MVP Scope)

### Var (MVP v1)

- [x] Hall oluştur (isim, grid boyutu)
- [x] Grid görüntüle (1m² kutucuklar)
- [x] Kutucuk seçerek stand oluştur (dikdörtgen + düzensiz şekil)
- [x] Stand numarası, bölge, tip ata
- [x] m² otomatik hesapla (hücre sayısı)
- [x] Özel alan tanımla (VIP, conference, registration vb.)
- [x] Firma ata (text input — assigned_company_name)
- [x] Stand statüsü değiştir (area_kind + commercial_status)
- [x] Renk kodlaması
- [x] Standı böl (split) / birleştir (merge)
- [x] Zoom + pan
- [x] Doluluk istatistikleri (stats bar)
- [x] PNG export (client-side)
- [x] PDF export (client-side, basit)
- [x] Versiyonlama (draft → active → archived)
- [x] Plan kopyala (clone — yeni versiyon veya yeni expo'ya)
- [x] Çoklu hall desteği

### Yok (Faz 2+)

- [ ] LİFFY entegrasyonu (company_id, contract_id FK'lar aktif)
- [ ] Stand assignment history
- [ ] Sözleşme onaylanınca otomatik statü güncellemesi
- [ ] Server-side branded PDF export (3 varyant)
- [ ] Canlı paylaşım linki (read-only, auth gerektirmez)
- [ ] Expo bazlı kombine plan görünümü (tüm hall'lar birlikte)
- [ ] Heatmap (check-in verisine göre yoğunluk)
- [ ] Stand öneri sistemi ("best position pricing")
- [ ] Fiyat katmanı (konuma göre m² fiyat farkı)
- [ ] Rebooking akışı (geçen yılki firmaları göster)
- [ ] Full audit trail / event sourcing
- [ ] Koridor hücre tipleri (unassigned → corridor / blocked / future_inventory ayrımı)
- [ ] Export audit log (hangi versiyon, ne zaman, kim tarafından, hangi formatta export edildi)

---

## 11. Kullanıcı Akışları

### Akış 1: Yeni Plan Oluşturma (Proje Ekibi)

```
Expo seç (dropdown)
    ↓
Hall oluştur: "Hall 1", grid: 40×25
    ↓
Yeni versiyon oluştur: "Draft v1"
    ↓
Grid açılır — 1000 kutucuk (40×25)
    ↓
Kutucukları seçerek standları çiz:
  - 3×3 seç → "Stand Oluştur" → A1 (9m²)
  - 6×11 seç → "Stand Oluştur" → B3 (66m²)
    ↓
Özel alanları tanımla:
  - 8×10 seç → "Özel Alan" → VIP Lounge
  - 10×12 seç → "Özel Alan" → Conference Area
    ↓
İstatistikleri kontrol et (alt bar)
    ↓
Versiyonu "Active" yap
    ↓
PDF export → Satış ekibine gönder
```

### Akış 2: Stand Bölme (Satış Süreci)

```
66m²'lik B3 standı seçildi
    ↓
"Böl" butonuna tıkla
    ↓
Bölme modu: Hangi hücreler yeni standa geçsin?
  - 36 hücre → B3a (36m²)
  - 30 hücre → B3b (30m²)
    ↓
Yeni stand kodları ata
    ↓
Yeni versiyon otomatik oluşur (veya mevcut draft'ta yapılır)
```

### Akış 3: Plan Klonlama (Yeni Edisyon)

```
"Mega Clima 2025" planı açık
    ↓
"Clone to New Expo" butonuna tıkla
    ↓
Hedef expo seç: "Mega Clima 2026"
    ↓
Fiziksel yerleşim kopyalanır (standlar, boyutlar, özel alanlar)
    ↓
Tüm firma atamaları TEMİZLENİR
    ↓
Tüm statüler "available" olur
    ↓
Yeni expo'da "Draft v1" versiyonu oluşur
```

---

## 12. ELL Roadmap Pozisyonu

```
ELL Roadmap v1.1
│
├── Faz 0 — Hazırlık (Q2 2026) ← ŞİMDİ
│   ├── LEENA fuar CRUD API
│   ├── Monorepo hazırlığı
│   └── ★ Floor Plan Builder MVP ← BU SPEC
│       ├── DB tabloları (ELL ortak PostgreSQL)
│       ├── API endpoints (LEENA backend)
│       ├── UI (react-konva, ELL tasarım dili)
│       └── Cell-based stand builder
│
├── Faz 1 — LİFFY MVP (Q3 2026)
│   ├── company_id, contract_id FK'lar aktif olur
│   ├── Sözleşme → Stand otomatik eşleştirme
│   └── Stand assignment history başlar
│
├── Faz 2 — LEENA MVP (Q4 2026)
│   ├── Floor Plan = LEENA 2.3 kat planı modülü (olgunlaşmış)
│   ├── Server-side branded PDF export
│   ├── Canlı paylaşım linki
│   └── Expo bazlı kombine görünüm
│
└── Faz 3 — ELIZA Upgrade (Q1 2027)
    ├── Doluluk metrikleri War Room'a
    ├── "Mega Clima doluluk % kaç?" sorguları
    └── Proaktif alertler ("4 hafta kaldı, %30 boş")
```

---

## 13. Sprint Planı (MVP Tahmini)

### Sprint 1: Altyapı — ✅ TAMAMLANDI (2026-03-30)

**Deliverables:**
- 5 DB tablo: `expo_halls`, `expo_floorplan_versions`, `expo_stands`, `expo_stand_cells`, `expo_stand_assignments`
- Trigger (`fn_update_stand_size_m2`) + partial unique index (one active per hall) + cell uniqueness constraint
- 8 API endpoint: halls CRUD, versions create/list, stands create/list/delete
- Frontend: Vanilla JS + Konva.js (CDN), modüler ES modules (state.js, grid.js, stands.js, toolbar.js, api.js)
- Rectangular marquee selection (draw mode — mousedown→drag→mouseup)
- Stand boundary rendering (iç hücre çizgileri yok, dış sınır belirgin 1.5px/2.5px)
- Label layout: stand_code sol alt, m² sağ alt, firma adı ortada (bounding box based)
- Optional stand_code (boş bırakılırsa otomatik `S-{id}`)
- `_cellMap` O(1) optimizasyon (getStandAtCell, getOccupiedCells)
- Leena sidebar entegrasyonu (bi-grid-3x3 icon)
- Migration file: `migrations/001_floorplan_tables.sql`

**Teknoloji kararı değişikliği:** Spec'te react-konva önerilmişti, implementasyonda Vanilla JS + Konva.js (CDN) tercih edildi. Gerekçe: mevcut sistemde React/build tool yok, sıfır altyapı değişikliği.

### Sprint 2: Stand Builder & Versiyonlama — ✅ TAMAMLANDI (2026-03-30)

**Deliverables:**
- Stand update: `PUT /stands/:id` general update + `PUT /stands/:id/status` quick status change
- Inline editing: detail panel with company name, display label, notes, Save Changes button
- Commercial status dropdown in detail panel (instant save, works on active versions per Invariant #2)
- Stand renk seçimi: 10-color pastel palette, stored in `metadata.color` JSONB. Custom color overrides status color in rendering.
- Special area type selector: `special_area_type` dropdown (vip, conference, registration, entrance, exit, technical, other) shown when `area_kind='special'`
- Version activate/archive: `POST /versions/:id/activate` (draft→active, old active→archived, transaction). `PUT /versions/:id` for label/notes.
- Background image overlay: PNG/JPG upload behind grid, localStorage persistence (base64, per expo+hall), opacity slider 5%-100%, `bgLayer` below `gridLayer`
- Stats bar live update: `standUpdated` event triggers real-time recalculation
- 4 new endpoints (total: 12 API endpoints)

**Not implemented (deferred to Sprint 3):** Stand duplicate, stand drag-to-move, connected shape validation, hall delete

### Sprint 3: İleri Operasyonlar & Export — ✅ TAMAMLANDI (2026-03-31)

**Deliverables:**
- Stand split: `POST /stands/:id/split` — dialog-based horizontal/vertical split at bounding box midpoint. Auto-suggests codes (B3a/B3b). Transaction validates complete cell coverage.
- Stand merge: `POST /stands/merge` — Shift+click multi-select, merge 2+ stands. Inherits properties from first stand.
- Version clone: `POST /versions/:id/clone` — deep copy all stands + cells. Optional `clear_assignments` flag.
- PNG export: client-side `stage.toDataURL({ pixelRatio: 2 })`. Auto-download. Includes background image.
- Stand duplicate: copy template → draw mode → pre-filled create dialog with `{code}-copy`.
- Stand drag-to-move: `PUT /stands/:id/move` — ghost overlay (green=valid, red=invalid), grid snap, draft-only.
- Multi-stand drag: Shift+click or marquee-select → drag all together. Parallel API calls.
- Select-mode marquee: left-drag on empty area → rectangle → multi-select stands.
- Pan controls: `stage.draggable=false`. Middle mouse or Space+drag = pan. Wheel = zoom.
- 4 new endpoints (total: 16 API endpoints)

**Split UX note:** Original spec proposed cell-by-cell assignment. Replaced with simpler horizontal/vertical dialog for faster UX. Backend split endpoint supports arbitrary cell distribution if needed later.

### Sprint 4: Olgunlaştırma (sıradaki)
- Background image UX (resize, reposition, alignment)
- Batch stand workflow (draw large area → split)
- Batch duplicate (copy selected stands to adjacent area)
- PDF export (branded, server-side)
- Connected shape validation (cell adjacency)
- Sidebar link to existing admin pages
- Erase mode marquee selection
- Stand resize (edge drag)
- Gerçek veriyle test (Mega Clima planını sisteme gir)

### Toplam MVP tahmini: 5-7 hafta (Sprint 1-3 tamamlandı, Sprint 4 devam)

---

## 14. Riskler & Azaltma

| Risk | Olasılık | Etki | Azaltma |
|------|----------|------|---------|
| react-konva öğrenme eğrisi | Orta | Orta | Sprint 1'de PoC, erken karar |
| Cell-based modelde performans (1000+ hücre) | Düşük | Orta | Batch insert, lazy render |
| Versiyonlama karmaşıklığı | Orta | Orta | MVP'de basit: draft/active/archived |
| Mevcut Leena akışına etki | Düşük | Yüksek | Tamamen ayrı tablolar, ayrı CSS, ayrı route |
| Stand bölme/birleştirme UX'i | Orta | Orta | İlk versiyonda basit: seç + böl |
| PDF export kalitesi (client-side) | Orta | Düşük | MVP kabul edilebilir, Faz 2'de server-side |

---

## 15. Başarı Kriterleri

MVP tamamlandığında:

- [ ] Proje ekibi (Yaprak) yeni fuar için hall oluşturup, grid üzerinde standları çizebilir
- [ ] Düzensiz şekilli standlar oluşturulabilir (L-şekil, T-şekil)
- [ ] Standlar bölünebilir ve birleştirilebilir
- [ ] Firma isimleri atanabilir, statüler değiştirilebilir
- [ ] Doluluk istatistikleri görüntülenebilir
- [ ] Plan PDF/PNG olarak dışa aktarılabilir
- [ ] Geçen yılın planı kopyalanabilir
- [ ] **CorelDRAW'a ihtiyaç duymadan kat planı oluşturulabilir**
- [ ] Mega Clima 2026 planı sisteme girilmiş ve çalışır durumda

---

*v2.1 — Final onaylı versiyon. ChatGPT sertleştirme kuralları (DB-level cell uniqueness, trigger-based size_m2, active version constraint, version immutability, FK target policy) eklendi. Gemini performans önerileri (Konva cache) dahil edildi. Tüm AI reviewer'lar tarafından geliştirmeye hazır olarak onaylanmıştır.*
