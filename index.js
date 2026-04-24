import express from 'express';
import bodyParser from 'body-parser';
import path from "path";

const app = express()


async function main() {
    try {
        app.use(bodyParser.json({
            verify: (req, res, buf) => {
                req.rawBody = buf.toString();
            }
        }));

        app.get('/', (req, res) => {
            return res.sendFile(path.join(process.cwd(), 'public', 'index.html'))
        })

        app.post('/newpurchase', (req, res) => {
            return true
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🌐 Webhook server running on port ${PORT}`);
        });
    } catch (e) {
        console.log("Error: ", e)
    }
}
main()