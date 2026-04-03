// Test SMS endpoint
const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/send-sms',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    }
};

const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('Response:', data);
        try {
            const json = JSON.parse(data);
            console.log('Parsed JSON:', json);
        } catch (e) {
            console.log('Failed to parse JSON:', e.message);
        }
    });
});

req.on('error', (error) => {
    console.error('Request error:', error);
});

req.write(JSON.stringify({
    phoneNumber: '+1234567890',
    damName: 'Test Dam'
}));

req.end();