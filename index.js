import express from 'express';

const app = express()

app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

app.get('/', (req, res) => {
    return res.status(200)
})

app.post('/newpurchase', (req, res) => {
    return true
});