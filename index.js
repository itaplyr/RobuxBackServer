import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const userMapPath = path.join(__dirname, 'data', 'usermap.json');
const purchasesPath = path.join(__dirname, 'data', 'purchases.json');

function ensureDataDir() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
}

function loadUserMap() {
    ensureDataDir();
    if (!fs.existsSync(userMapPath)) {
        fs.writeFileSync(userMapPath, JSON.stringify({}));
        return {};
    }
    return JSON.parse(fs.readFileSync(userMapPath, 'utf-8'));
}

function saveUserMap(map) {
    ensureDataDir();
    fs.writeFileSync(userMapPath, JSON.stringify(map, null, 2));
}

function loadPurchases() {
    ensureDataDir();
    if (!fs.existsSync(purchasesPath)) {
        fs.writeFileSync(purchasesPath, JSON.stringify([]));
        return [];
    }
    return JSON.parse(fs.readFileSync(purchasesPath, 'utf-8'));
}

function savePurchase(purchase) {
    ensureDataDir();
    const purchases = loadPurchases();
    purchases.push({ ...purchase, timestamp: new Date().toISOString() });
    fs.writeFileSync(purchasesPath, JSON.stringify(purchases, null, 2));
}

async function sendDMToUser(discordId, message) {
    try {
        const user = await client.users.fetch(discordId);
        if (user) {
            const dm = await user.createDM();
            await dm.send(message);
            return true;
        }
    } catch (e) {
        console.error(`Failed to send DM to ${discordId}:`, e.message);
    }
    return false;
}

const commands = [
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Roblox account to receive cashback')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Your Roblox username')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your cashback balance'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help about the cashback system')
];

async function registerCommands() {
    if (!DISCORD_TOKEN || !client.user?.id) {
        console.log('WARNING: Missing DISCORD_TOKEN or client not ready');
        return;
    }

    const clientId = client.user.id;
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    try {
        if (GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(clientId, GUILD_ID),
                { body: commands }
            );
            console.log(`✅ Registered commands to guild ${GUILD_ID}`);
        } else {
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands }
            );
            console.log('✅ Registered global commands');
        }
    } catch (e) {
        console.error('Failed to register commands:', e);
    }
}

client.once('ready', async () => {
    console.log(`🤖 Discord bot logged in as ${client.user.tag}`);
    await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, user } = interaction;

    if (commandName === 'link') {
        const username = interaction.options.getString('username');
        const userMap = loadUserMap();
        userMap[username] = user.id;
        saveUserMap(userMap);

        await interaction.reply({ content: `✅ Linked **${username}** to your Discord account! You'll receive cashback DMs.`, ephemeral: true });
    } else if (commandName === 'balance') {
        const userMap = loadUserMap();
        const linkedUsername = Object.keys(userMap).find(key => userMap[key] === user.id);

        if (!linkedUsername) {
            await interaction.reply({ content: '❌ You haven\'t linked a Roblox account yet. Use /link to link your account.', ephemeral: true });
            return;
        }

        const purchases = loadPurchases().filter(p => p.player === linkedUsername);
        const totalCashback = purchases.reduce((sum, p) => {
            const rakeback = typeof p.rakeback === 'number' ? p.rakeback : parseFloat(p.rakeback) || 0;
            return sum + rakeback;
        }, 0);

        await interaction.reply({
            content: `💰 **Balance for ${linkedUsername}**\n\n**Total Purchases:** ${purchases.length}\n**Total Cashback Received:** 🎰 ${totalCashback.toFixed(0)} R$`,
            ephemeral: true
        });
    } else if (commandName === 'help') {
        await interaction.reply({
            content: `📖 **Cashback Bot Help**\n\n` +
                `**/link [username]** - Link your Roblox account to receive cashback on purchases\n` +
                `**/balance** - Check your total cashback received\n` +
                `**/help** - Show this help message\n\n` +
                `Make purchases in-game and get cashback sent to your DMs!`,
            ephemeral: true
        });
    }
});

async function main() {
    try {
        app.use(bodyParser.json({
            verify: (req, res, buf) => {
                req.rawBody = buf.toString();
            }
        }));

        app.get('/', (req, res) => {
            return res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        app.post('/newpurchase', async (req, res) => {
            try {
                const data = req.body;
                console.log('Received purchase:', data);

                const userMap = loadUserMap();
                const discordId = userMap[data.player];

                if (!discordId) {
                    console.log(`User ${data.player} not linked to Discord`);
                    return res.status(200).json({ success: false, message: 'User not linked' });
                }

                const rakeback = typeof data.rakeback === 'number' ? data.rakeback : parseFloat(data.rakeback) || 0;
                const typeFormatted = data.type === 'GamePass' ? 'Game Pass' : data.type;

                const message = `🎉 **Purchase Confirmed!**\n\n` +
                    `**Type:** ${typeFormatted}\n` +
                    `**Asset:** ${data.assetName || 'N/A'}\n` +
                    `**Price:** ${data.price} R$\n` +
                    `**Cashback:** 🎰 ${rakeback.toFixed(0)} R$\n\n` +
                    `Your cashback has been processed! Enjoy your purchase!`;

                const sent = await sendDMToUser(discordId, message);

                savePurchase(data);

                return res.status(200).json({ success: sent, message: sent ? 'DM sent' : 'DM failed' });
            } catch (e) {
                console.error('Error processing purchase:', e);
                return res.status(500).json({ success: false, error: e.message });
            }
        });

        app.post('/link', (req, res) => {
            try {
                const { robloxUsername, discordId } = req.body;

                if (!robloxUsername || !discordId) {
                    return res.status(400).json({ success: false, message: 'Missing robloxUsername or discordId' });
                }

                const userMap = loadUserMap();
                userMap[robloxUsername] = discordId;
                saveUserMap(userMap);

                console.log(`Linked ${robloxUsername} -> ${discordId}`);

                return res.status(200).json({ success: true, message: 'Linked successfully' });
            } catch (e) {
                console.error('Error linking user:', e);
                return res.status(500).json({ success: false, error: e.message });
            }
        });

        app.get('/link/:username', (req, res) => {
            const { username } = req.params;
            const userMap = loadUserMap();
            const discordId = userMap[username];

            return res.status(200).json({ linked: !!discordId, discordId });
        });

        app.get('/purchases', (req, res) => {
            const purchases = loadPurchases();
            return res.status(200).json(purchases);
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🌐 Webhook server running on port ${PORT}`);
        });

        if (DISCORD_TOKEN) {
            await client.login(DISCORD_TOKEN);
        } else {
            console.log('WARNING: DISCORD_TOKEN not set in environment variables');
        }
    } catch (e) {
        console.log('Error:', e);
    }
}

main();