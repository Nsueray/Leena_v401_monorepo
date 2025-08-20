const express = require('express');
const app = express();
const PORT = 3001; // Temiz bir başlangıç için farklı bir port kullanıyoruz

console.log('>>> [TEST-SERVER] Sunucu başlatılıyor...');

app.get('/', (req, res) => {
    console.log(`>>> [TEST-SERVER] İstek geldi! URL: ${req.url}`);
    res.send('Merhaba, test sunucusu çalışıyor!');
});

app.listen(PORT, () => {
    console.log(`>>> [TEST-SERVER] ✅ Sunucu şimdi http://localhost:${PORT} adresinde dinliyor`);
});
