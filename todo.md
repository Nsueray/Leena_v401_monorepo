# Leena EMS — TODO & Roadmap

> Son güncelleme: 23 Şubat 2026
> Aktif fuar: Mega Horeca Ghana
> Admin panel: masaüstü/laptop kullanılıyor (mobil öncelik düşük)

---

## 🔴 Sprint 1 — Güvenlik Hotfix (Fuar dışı saatlerde, 1 gün)

Bunlar teknik borç değil, açık kapı. Tek organizer olduğu sürece tetiklenmiyor ama düzeltilmeli.

- [ ] `visitors.js:239` — POST /api/visitors/manual'a authMiddleware ekle
- [ ] `visitors.js:328` — Import route'da `req.organizer_id` kullan (`req.user?.id` yerine)
- [ ] `webhook.js:8` — Hardcoded Zoho secret'ı env variable'a taşı (ZOHO_WEBHOOK_TOKEN)
- [ ] `qrscanner.html:437` — localStorage key uyumsuzluğu düzelt (organizerId → organizer_id)
- [ ] `visitors.js:99` — Badge endpoint SELECT * yerine sadece gerekli alanları dön (PII kısıtla)

## 🟠 Sprint 2 — Sidebar Stabilizasyon (Fuar öncesi, 2-3 gün)

Operasyonel etki: hostesler/admin sayfalar arası geçiş yapamıyor.
CSS'e dokunma, layout'a dokunma — sadece sidebar link listesini düzelt.

- [ ] 8 sayfadaki Forms link hedefini `form-builder.html` → `form-list.html` olarak düzelt
- [ ] Tüm admin sayfalara `checkin-reports.html` sidebar linki ekle (11 sayfada eksik)
- [ ] Tüm admin sayfalara `email-send.html` sidebar linki ekle (13 sayfada eksik)
- [ ] Tüm admin sayfalara `reactivation-campaign.html` sidebar linki ekle (9 sayfada eksik)
- [ ] `email-send.html` active state bug'ını düzelt (Email Templates yerine Email Send aktif olmalı)
- [ ] Login redirect tekleştir: tüm sayfalar login.html'e yönlensin, login.html → main-panel-v2.html

## 🟡 Sprint 3 — Email Stabilizasyon (Fuar sonrası, 1 hafta)

Fuar sırasındaki "email gitmiyor" sorununun kök nedeni: 5 yerde direkt SendGrid çağrısı var.

- [ ] webhook.js → email_queue üzerinden gönder (direkt sgMail.send kaldır)
- [ ] visitors.js import → email_queue üzerinden gönder
- [ ] visitors.js public form → email_queue üzerinden gönder
- [ ] emailSend.js bulk/single → email_queue üzerinden gönder
- [ ] emailSegments.js → email_queue üzerinden gönder
- [ ] `email_worker.js:26-33` — FOR UPDATE'i transaction içine al
- [ ] `emailSend.js:68,170` — BASE_BADGE_URL fallback ekle

## 🟢 Sprint 4 — Race Condition & Error Handling (Fuar sonrası, 3-5 gün)

- [ ] `leads.js:99-128` — Duplicate check'i ON CONFLICT ile değiştir
- [ ] `visitors.js:248,389` — Manual/import upsert'i transaction + ON CONFLICT ile güçlendir
- [ ] Hata yanıt formatını standardize et: tüm route'lar `{success: bool, message: string}` dönsün
- [ ] Auth check standardizasyonu: tüm admin sayfalara DOMContentLoaded'da token + expoId kontrolü

## 🔵 Sprint 5 — UI Unification (SaaS hazırlığı, 2-3 hafta)

Bu büyük refactor. Fuar yokken yapılacak.

- [ ] Sidebar component oluştur (tek JS include — tüm sayfalar aynı sidebar'ı çeker)
- [ ] CSS variable standardizasyonu (Gen 4 baz alınarak)
- [ ] Inline CSS → tek CSS dosyasına taşı
- [ ] Login flow tekleştir (login_new kaldır veya login.html'i güncelle)
- [ ] Dashboard tekleştir (dashboard.html, dashboard_new.html kaldır)
- [ ] Mobil sidebar: hamburger menü + overlay (tüm sayfalar)
- [ ] Bootstrap Icons versiyonunu tekleştir (v1.11.0)

## 🗑️ Sprint 6 — Temizlik

- [ ] Legacy sayfaları sil: dashboard.html, dashboard_new.html, admin-dashboard.html, main-panel.html
- [ ] *.backup.html dosyalarını sil (7 adet)
- [ ] 17 dead code endpoint'i kaldır
- [ ] leena.css sil (artık kullanılmıyor)
- [ ] Console.log temizliği (production)
- [ ] initial.sql'i production DB ile senkronize et

---

## 📋 Stratejik Notlar

1. **Sprint 1+2 Ghana öncesi yapılabilir** — küçük, izole değişiklikler
2. **Sprint 3 en büyük operasyonel iyileştirme** — email güvenilirliğini kökten çözer
3. **Sprint 5 (UI Unification) diğer tüm UI işlerini kolaylaştırır** — sidebar component yapılınca Sprint 2 tarzı işler bir daha olmaz
4. **Tek organizer olduğu sürece Sprint 1 #2 acil değil** ama ikinci organizer eklenmeden önce MUTLAKA düzeltilmeli
5. **CSS nesil birleştirme, active state refactor, sidebar genişliği** — SaaS fazına bırakıldı, fuar öncesi riskli
