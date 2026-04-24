import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } from 'discord.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);

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
            option.setName('userid')
                .setDescription('Your Roblox UserId (find at roblox.com/user)')
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your cashback balance'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help about the cashback system'),
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin panel - view all purchases')
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

client.once('clientReady', async () => {
    console.log(`🤖 Discord bot logged in as ${client.user.tag}`);
    await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    const { commandName, user, message: msg } = interaction;

    if (commandName === 'link') {
        const userId = interaction.options.getString('userid');
        const userMap = loadUserMap();
        userMap[userId] = user.id;
        saveUserMap(userMap);

        await interaction.reply({ content: `✅ Linked Roblox account **${userId}** to your Discord account! You'll receive cashback DMs.`, ephemeral: true });
    } else if (commandName === 'balance') {
        const userMap = loadUserMap();
        const linkedUserId = Object.keys(userMap).find(key => userMap[key] === user.id);

        if (!linkedUserId) {
            await interaction.reply({ content: '❌ You haven\'t linked a Roblox account yet. Use /link to link your account.', ephemeral: true });
            return;
        }

        const purchases = loadPurchases().filter(p => p.userId == linkedUserId);
        const totalCashback = purchases.reduce((sum, p) => {
            const rakeback = typeof p.rakeback === 'number' ? p.rakeback : parseFloat(p.rakeback) || 0;
            return sum + rakeback;
        }, 0);

        await interaction.reply({
            content: `💰 **Balance for UserId ${linkedUserId}**\n\n**Total Purchases:** ${purchases.length}\n**Total Cashback Received:** 🎰 ${totalCashback.toFixed(0)} R$`,
            ephemeral: true
        });
    } else if (commandName === 'help') {
        await interaction.reply({
            content: `📖 **Cashback Bot Help**\n\n` +
                `**/link [userid]** - Link your Roblox UserId to receive cashback on purchases\n` +
                `**/balance** - Check your total cashback received\n` +
                `**/help** - Show this help message\n\n` +
                `Make purchases in-game and get cashback sent to your DMs!`,
            ephemeral: true
        });
    } else if (commandName === 'admin') {
        if (!ADMIN_IDS.includes(user.id)) {
            await interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
            return;
        }

        const purchases = loadPurchases();
        const userMap = loadUserMap();

        const itemsPerPage = 5;
        let currentPage = 0;
        
        const formatPurchase = (p, index) => {
            const robloxUserId = p.userId;
            const discordId = userMap[robloxUserId];
            const rakeback = typeof p.rakeback === 'number' ? p.rakeback : parseFloat(p.rakeback) || 0;
            return `**${index + 1}.** ${p.type} - ${p.assetName || 'N/A'}\n` +
                `   UserId: ${p.userId} | Price: ${p.price} R$\n` +
                `   Cashback: 🎰 ${rakeback.toFixed(0)} R$ | ${discordId ? '✅ Paid' : '❌ Not Paid'}\n` +
                `   Date: ${p.timestamp || 'N/A'}`;
        };

        const getPageContent = (page) => {
            const start = page * itemsPerPage;
            const end = start + itemsPerPage;
            const pageItems = purchases.slice(start, end);
            
            if (pageItems.length === 0) return null;
            
            return pageItems.map((p, i) => formatPurchase(p, start + i)).join('\n\n');
        };

        const totalPages = Math.ceil(purchases.length / itemsPerPage) - 1;
        const initialContent = getPageContent(0);

        const embed = new EmbedBuilder()
            .setTitle('📊 Admin Panel - Purchases')
            .setDescription(initialContent || 'No purchases found.')
            .setFooter({ text: `Page ${currentPage + 1}/${totalPages + 1} | Total: ${purchases.length} purchases` });

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('admin_prev')
                    .setLabel('◀')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(currentPage === 0),
                new ButtonBuilder()
                    .setCustomId('admin_profile')
                    .setLabel('👤 View Profile')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('admin_next')
                    .setLabel('▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(currentPage >= totalPages)
            );

        await interaction.reply({ embeds: [embed], components: [buttons], ephemeral: true });
    }

    if (interaction.isButton()) {
        const customId = interaction.customId;
        const purchaseData = msg?.embeds?.[0]?.description || '';
        
        if (customId === 'admin_prev' || customId === 'admin_next') {
            if (!ADMIN_IDS.includes(user.id)) {
                await interaction.reply({ content: '❌ You are not authorized.', ephemeral: true });
                return;
            }

            const purchases = loadPurchases();
            const itemsPerPage = 5;
            const totalPages = Math.ceil(purchases.length / itemsPerPage) - 1;

            if (customId === 'admin_prev') {
                currentPage = Math.max(0, currentPage - 1);
            } else {
                currentPage = Math.min(totalPages, currentPage + 1);
            }

            const formatPurchase = (p, index) => {
                const robloxUserId = p.userId;
                const userMap = loadUserMap();
                const discordId = userMap[robloxUserId];
                const rakeback = typeof p.rakeback === 'number' ? p.rakeback : parseFloat(p.rakeback) || 0;
                return `**${index + 1}.** ${p.type} - ${p.assetName || 'N/A'}\n` +
                    `   UserId: ${p.userId} | Price: ${p.price} R$\n` +
                    `   Cashback: 🎰 ${rakeback.toFixed(0)} R$ | ${discordId ? '✅ Paid' : '❌ Not Paid'}\n` +
                    `   Date: ${p.timestamp || 'N/A'}`;
            };

            const getPageContent = (page) => {
                const start = page * itemsPerPage;
                const end = start + itemsPerPage;
                const pageItems = purchases.slice(start, end);
                if (pageItems.length === 0) return null;
                return pageItems.map((p, i) => formatPurchase(p, start + i)).join('\n\n');
            };

            const newContent = getPageContent(currentPage);

            const embed = new EmbedBuilder()
                .setTitle('📊 Admin Panel - Purchases')
                .setDescription(newContent || 'No purchases found.')
                .setFooter({ text: `Page ${currentPage + 1}/${totalPages + 1} | Total: ${purchases.length} purchases` });

            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('admin_prev')
                        .setLabel('◀')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId('admin_profile')
                        .setLabel('👤 View Profile')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('admin_next')
                        .setLabel('▶')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(currentPage >= totalPages)
                );

            await interaction.update({ embeds: [embed], components: [buttons] });
        } else if (customId === 'admin_profile') {
            if (!ADMIN_IDS.includes(user.id)) {
                await interaction.reply({ content: '❌ You are not authorized.', ephemeral: true });
                return;
            }

            const purchases = loadPurchases();
            const itemsPerPage = 5;
            const start = currentPage * itemsPerPage;
            const pageItems = purchases.slice(start, start + itemsPerPage);
            
            let userIdList = [...new Set(pageItems.map(p => p.userId))];
            
            if (userIdList.length > 0) {
                const selectedUserId = userIdList[0];
                await interaction.reply({ 
                    content: `🔗 **Roblox Profile for UserId ${selectedUserId}**\n\nhttps://www.roblox.com/user.aspx?userid=${selectedUserId}`, 
                    ephemeral: true 
                });
            } else {
                await interaction.reply({ content: 'No user data available.', ephemeral: true });
            }
        }
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
                const rawBody = req.rawBody;
                console.log('Raw body:', rawBody);
                console.log('Parsed body:', req.body);
                
                const data = req.body;
                if (!data || !data.userId) {
                    console.log('Invalid purchase data: missing userId, data:', JSON.stringify(data));
                    return res.status(200).json({ success: false, message: 'Invalid data' });
                }

                const userMap = loadUserMap();
                const discordId = userMap[data.userId];

                if (!discordId) {
                    console.log(`User ${data.userId} not linked to Discord`);
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
                const { robloxUserId, discordId } = req.body;

                if (!robloxUserId || !discordId) {
                    return res.status(400).json({ success: false, message: 'Missing robloxUserId or discordId' });
                }

                const userMap = loadUserMap();
                userMap[robloxUserId] = discordId;
                saveUserMap(userMap);

                console.log(`Linked ${robloxUserId} -> ${discordId}`);

                return res.status(200).json({ success: true, message: 'Linked successfully' });
            } catch (e) {
                console.error('Error linking user:', e);
                return res.status(500).json({ success: false, error: e.message });
            }
        });

        app.get('/link/:userId', (req, res) => {
            const { userId } = req.params;
            const userMap = loadUserMap();
            const discordId = userMap[userId];

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