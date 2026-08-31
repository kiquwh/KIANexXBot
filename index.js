const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('BOT_TOKEN environment variable is missing.');
    process.exit(1);
}
const ADMIN_ID = 8854073031;

const bot = new Telegraf(BOT_TOKEN);

const volumeDir = '/data';
let DATA_FILE;
try {
    if (!fs.existsSync(volumeDir)) {
        fs.mkdirSync(volumeDir, { recursive: true });
    }
    DATA_FILE = path.join(volumeDir, 'data.json');
} catch (e) {
    DATA_FILE = path.join(__dirname, 'data.json');
}

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = {
            tokens: {},
            botStatus: { active: true, reason: '' },
            userStates: {}
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// معتبرسازی توکن ریلی‌وی و دریافت اطلاعات و Workspace کاربر
async function railwayRequest(token, query, variables = {}) {
    const response = await axios.post(
        'https://backboard.railway.com/graphql/v2',
        { query, variables },
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        }
    );

    if (response.data?.errors?.length) {
        throw new Error(response.data.errors.map(e => e.message).join(' | '));
    }

    return response.data?.data;
}

async function validateRailwayToken(token) {
    try {
        // Account token: دریافت اطلاعات حساب و Workspaceها
        try {
            const data = await railwayRequest(token, `
                query {
                    me {
                        email
                        name
                        workspaces { id name }
                    }
                }
            `);

            const me = data?.me;
            const workspaces = me?.workspaces || [];

            if (me && workspaces.length > 0) {
                return {
                    valid: true,
                    email: me.email || 'user@railway.app',
                    workspaceId: workspaces[0].id,
                    workspaceName: workspaces[0].name
                };
            }

            if (me) {
                return {
                    valid: true,
                    email: me.email || 'user@railway.app',
                    workspaceId: null,
                    workspaceName: null
                };
            }
        } catch (_) {
            // ممکن است توکن Workspace باشد؛ پایین‌تر آن را بررسی می‌کنیم.
        }

        // Workspace token / حساب‌هایی که me.workspaces را برنمی‌گردانند
        const data = await railwayRequest(token, `
            query {
                workspaces { id name }
            }
        `);

        const workspaces = data?.workspaces || [];
        if (workspaces.length > 0) {
            return {
                valid: true,
                email: 'Railway Workspace',
                workspaceId: workspaces[0].id,
                workspaceName: workspaces[0].name
            };
        }

        return { valid: false, error: 'هیچ Workspace قابل دسترسی برای این توکن پیدا نشد.' };
    } catch (e) {
        return {
            valid: false,
            error: e.message || 'توکن Railway نامعتبر است یا دسترسی کافی ندارد.'
        };
    }
}

// تابع ساخت واقعی و قدم‌به‌قدم روی ریلی‌وی
async function deployLuffyPanelToRailway(userTokenObj, ctx) {
    const token = userTokenObj.railwayToken;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    try {
        if (!userTokenObj.workspaceId) {
            throw new Error('برای این توکن هیچ Workspace ID پیدا نشد. یک Account/Workspace API Token با دسترسی Workspace استفاده کنید.');
        }

        // گام ۱: ساخت پروژه در Workspace
        await ctx.editMessageText('⏳ قدم ۱/۴: در حال ساخت پروژه جدید در حساب ریلی‌وی شما...');

        const projectName = `KIA-Nex-Panel-${Date.now()}`;
        const createProjectRes = await axios.post(
            'https://backboard.railway.com/graphql/v2',
            {
                query: `
                    mutation projectCreate($input: ProjectCreateInput!) {
                        projectCreate(input: $input) {
                            id
                            name
                            environments {
                                edges {
                                    node { id name }
                                }
                            }
                        }
                    }
                `,
                variables: {
                    input: {
                        name: projectName,
                        teamId: userTokenObj.workspaceId
                    }
                }
            },
            { headers, timeout: 60000 }
        );

        if (createProjectRes.data?.errors?.length) {
            throw new Error(createProjectRes.data.errors.map(e => e.message).join(' | '));
        }

        const project = createProjectRes.data?.data?.projectCreate;
        const projectId = project?.id;
        if (!projectId) {
            throw new Error('Railway پروژه را ساخت اما شناسه پروژه دریافت نشد.');
        }

        // گام ۲: پیدا کردن Environment پیش‌فرض
        await ctx.editMessageText('⏳ قدم ۲/۴: در حال آماده‌سازی Environment پروژه...');

        let environmentId = project?.environments?.edges?.[0]?.node?.id || null;

        if (!environmentId) {
            const envRes = await axios.post(
                'https://backboard.railway.com/graphql/v2',
                {
                    query: `
                        query project($id: String!) {
                            project(id: $id) {
                                environments {
                                    edges { node { id name } }
                                }
                            }
                        }
                    `,
                    variables: { id: projectId }
                },
                { headers, timeout: 30000 }
            );

            if (envRes.data?.errors?.length) {
                throw new Error(envRes.data.errors.map(e => e.message).join(' | '));
            }

            environmentId = envRes.data?.data?.project?.environments?.edges?.[0]?.node?.id || null;
        }

        if (!environmentId) {
            throw new Error('Environment پیش‌فرض Railway پیدا نشد.');
        }

        // گام ۳: ساخت سرویس از GitHub
        await ctx.editMessageText('⏳ قدم ۳/۴: در حال اتصال مخزن GitHub (LUFFY_PANEL)...');

        const serviceRes = await axios.post(
            'https://backboard.railway.com/graphql/v2',
            {
                query: `
                    mutation serviceCreate($input: ServiceCreateInput!) {
                        serviceCreate(input: $input) { id name }
                    }
                `,
                variables: {
                    input: {
                        projectId,
                        environmentId,
                        name: 'luffy-panel',
                        source: { repo: 'luffy-sh-op/LUFFY_PANEL' }
                    }
                }
            },
            { headers, timeout: 60000 }
        );

        if (serviceRes.data?.errors?.length) {
            throw new Error(serviceRes.data.errors.map(e => e.message).join(' | '));
        }

        const serviceId = serviceRes.data?.data?.serviceCreate?.id;
        if (!serviceId) {
            throw new Error('سرویس ساخته نشد یا Service ID دریافت نشد.');
        }

        // گام ۴: تنظیم PORT و ساخت دامنه Railway
        await ctx.editMessageText('⏳ قدم ۴/۴: تنظیم پورت و ساخت لینک نهایی...');

        try {
            const variableRes = await axios.post(
                'https://backboard.railway.com/graphql/v2',
                {
                    query: `
                        mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
                            variableCollectionUpsert(input: $input)
                        }
                    `,
                    variables: {
                        input: {
                            projectId,
                            environmentId,
                            serviceId,
                            variables: { PORT: '8080' }
                        }
                    }
                },
                { headers, timeout: 30000 }
            );

            if (variableRes.data?.errors?.length) {
                console.log('PORT variable warning:', variableRes.data.errors);
            }
        } catch (err) {
            console.log('PORT variable warning:', err.message);
        }

        let domain = null;
        try {
            const domainRes = await axios.post(
                'https://backboard.railway.com/graphql/v2',
                {
                    query: `
                        mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
                            serviceDomainCreate(input: $input) { domain }
                        }
                    `,
                    variables: {
                        input: { serviceId, environmentId }
                    }
                },
                { headers, timeout: 30000 }
            );

            if (domainRes.data?.errors?.length) {
                console.log('Domain warning:', domainRes.data.errors);
            } else {
                domain = domainRes.data?.data?.serviceDomainCreate?.domain || null;
            }
        } catch (err) {
            console.log('Domain warning:', err.message);
        }

        if (!domain) {
            throw new Error('سرویس ساخته شد، اما Railway نتوانست Domain بسازد.');
        }

        const panelLink = `https://${domain}/dashboard`;

        const successText = `🎉 پنل با موفقیت ساخته شد!

🚀 پنل شما آماده استفاده است.

🔗 لینک پنل:
${panelLink}

🔐 رمز عبور پنل:
admin

━━━━━━━━━━━━━━
⚡️ 𝑲𝑰𝑨 𝑵𝒆𝒙
💡 لطفاً رمز عبور خود را با دیگران به اشتراک نگذارید.
✅ با استفاده از لینک بالا وارد پنل شوید و مدیریت خود را آغاز کنید.`;

        await ctx.editMessageText(successText, Markup.inlineKeyboard([
            [Markup.button.callback('🏠 بازگشت به منوی اصلی', 'main_menu')]
        ]));

    } catch (error) {
        const errorMsg =
            error.response?.data?.errors?.map(e => e.message).join(' | ') ||
            error.response?.data?.message ||
            error.message ||
            'خطای ناشناخته';

        console.error('Railway deployment error:', error.response?.data || error);

        await ctx.editMessageText(
            `❌ خطا در ساخت پنل روی ریلی‌وی!\n\nجزئیات خطا: ${errorMsg}\n\n💡 مطمئن شوید توکن Railway دسترسی ساخت Project در Workspace را دارد.`,
            Markup.inlineKeyboard([
                [Markup.button.callback('🔙 بازگشت', 'build_panel')]
            ])
        );
    }
}

const welcomeText = `🚀 به 𝑲𝑰𝑨 𝑵𝒆𝒙 خوش آمدید!
⚡ نسل جدید ساخت و مدیریت سرویس‌های هوشمند
با 𝑲𝑰𝑨 𝑵𝒆𝒙 می‌تونی در سریع‌ترین زمان ممکن سرویس خودت رو بسازی و مدیریت کنی.

🔹 ساخت خودکار و سریع
🔹 مدیریت آسان و حرفه‌ای
🔹 رابط کاربری مدرن
🔹 امکانات قدرتمند و کاربردی
🔹 عملکرد سریع و پایدار
━━━━━━━━━━━━━━
💎 𝑲𝑰𝑨 𝑵𝒆𝒙
ساده بساز، حرفه‌ای مدیریت کن.`;

const mainMenuKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🏗️ ساخت پنل', 'build_panel')],
    [Markup.button.callback('🔐 مدیریت توکن', 'manage_tokens')]
]);

bot.start(async (ctx) => {
    const db = loadData();
    if (!db.botStatus.active && ctx.from.id !== ADMIN_ID) {
        return ctx.reply(`🔴 پنل موقتاً خاموش است\n\n📌 دلیل خاموشی:\n${db.botStatus.reason}`);
    }
    await ctx.reply(welcomeText, mainMenuKeyboard);
});

bot.action('manage_tokens', async (ctx) => {
    const userId = ctx.from.id;
    const db = loadData();
    const userTokens = db.tokens[userId] || [];

    let tokensListText = userTokens.length > 0 
        ? userTokens.map((t, index) => `${index + 1}️⃣ توکن ریلی‌وی: ...${t.railwayToken.slice(-8)} | ایمیل: ${t.email}`).join('\n')
        : '❌ هیچ توکن ریلی‌وی ثبت نشده است.';

    const text = `🔐 مدیریت توکن‌ها (Railway API Token)
در این بخش می‌توانید توکن ریلی‌وی خود را به‌سادگی ثبت، مدیریت یا حذف کنید.

➕ برای افزودن توکن جدید، گزینه ثبت توکن را انتخاب کنید.
🗑️ برای حذف توکن‌های قبلی، گزینه حذف توکن را بزنید.
⚡️ مدیریت آسان و سریع توکن‌ها با 𝑲𝑰𝑨 𝑵𝒆𝒙

📋 توکن‌های ثبت شده شما:
${tokensListText}`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ افزودن توکن جدید', 'add_token')],
        [Markup.button.callback('🗑️ حذف توکن‌های قبلی', 'delete_tokens')],
        [Markup.button.callback('🔙 بازگشت', 'main_menu')]
    ]);

    await ctx.editMessageText(text, keyboard);
});

bot.action('main_menu', async (ctx) => {
    await ctx.editMessageText(welcomeText, mainMenuKeyboard);
});

bot.action('add_token', async (ctx) => {
    const db = loadData();
    db.userStates[ctx.from.id] = 'WAITING_FOR_RAILWAY_TOKEN';
    saveData(db);

    await ctx.editMessageText(
        `➕ لطفاً **توکن حساب ریلی‌وی (Railway API Token)** خود را ارسال کنید:\n\n(برای لغو روی بازگشت بزنید)`,
        Markup.inlineKeyboard([
            [Markup.button.callback('🔙 بازگشت', 'manage_tokens')]
        ])
    );
});

bot.action('delete_tokens', async (ctx) => {
    const userId = ctx.from.id;
    const db = loadData();
    db.tokens[userId] = [];
    saveData(db);

    await ctx.answerCbQuery('تمام توکن‌های قبلی حذف شد!');
    return ctx.editMessageText(
        `🗑️ تمام توکن‌های ریلی‌وی شما با موفقیت حذف شدند.\n\n🔐 مدیریت توکن‌ها`,
        Markup.inlineKeyboard([
            [Markup.button.callback('➕ افزودن توکن جدید', 'add_token')],
            [Markup.button.callback('🔙 بازگشت', 'main_menu')]
        ])
    );
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    const db = loadData();

    if (userId === ADMIN_ID) {
        if (text === '/admin' || text === 'پنل') {
            return ctx.reply('👑 پنل مدیریت ربات:', Markup.inlineKeyboard([
                [Markup.button.callback('🔴 خاموش کردن ربات', 'admin_off')],
                [Markup.button.callback('🟢 روشن کردن ربات', 'admin_on')]
            ]));
        }

        if (db.userStates[userId] === 'WAITING_FOR_OFF_REASON') {
            db.botStatus.active = false;
            db.botStatus.reason = text;
            db.userStates[userId] = null;
            saveData(db);
            return ctx.reply('✅ ربات با موفقیت خاموش شد و پیام قطع برای کاربران اعمال گردید.');
        }
    }

    if (db.userStates[userId] === 'WAITING_FOR_RAILWAY_TOKEN') {
        db.userStates[userId] = null;
        saveData(db);

        const status = await validateRailwayToken(text);
        if (!status.valid) {
            return ctx.reply(`❌ توکن ریلی‌وی قابل استفاده نیست!\n\n${status.error || 'لطفاً یک API Token معتبر با دسترسی Workspace ارسال کنید.'}`, 
                Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'manage_tokens')]])
            );
        }

        if (!db.tokens[userId]) db.tokens[userId] = [];
        db.tokens[userId].push({
            railwayToken: text,
            email: status.email,
            workspaceId: status.workspaceId
        });
        saveData(db);

        return ctx.reply(`✅ توکن ریلی‌وی با موفقیت تایید شد!\n📧 ایمیل اکانت متصل: ${status.email}`,
            Markup.inlineKeyboard([
                [Markup.button.callback('🔐 مدیریت توکن‌ها', 'manage_tokens')],
                [Markup.button.callback('🏠 بازگشت به منوی اصلی', 'main_menu')]
            ])
        );
    }
});

bot.action('admin_off', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const db = loadData();
    db.userStates[ADMIN_ID] = 'WAITING_FOR_OFF_REASON';
    saveData(db);
    await ctx.reply('⚠️ لطفاً دلیل خاموش کردن پنل را ارسال کنید:');
});

bot.action('admin_on', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const db = loadData();
    db.botStatus.active = true;
    db.botStatus.reason = '';
    saveData(db);
    await ctx.reply('🟢 پنل با موفقیت فعال شد و به حالت عادی برگشت.');
});

bot.action('build_panel', async (ctx) => {
    const userId = ctx.from.id;
    const db = loadData();
    const userTokens = db.tokens[userId] || [];

    if (userTokens.length === 0) {
        return ctx.answerCbQuery('لطفا ابتدا از گزینه مدیریت توکن، توکن ریلی‌وی ثبت کنید!', { show_alert: true });
    }

    const buttons = userTokens.map((t, idx) => [
        Markup.button.callback(`🔹 اکانت ${t.email} (...${t.railwayToken.slice(-6)})`, `select_token_${idx}`)
    ]);
    buttons.push([Markup.button.callback('🔙 بازگشت', 'main_menu')]);

    await ctx.editMessageText('🔑 لطفاً توکن ریلی‌وی مورد نظر خود را برای ساخت پنل انتخاب کنید:', Markup.inlineKeyboard(buttons));
});

bot.action(/select_token_(\d+)/, async (ctx) => {
    const tokenIndex = ctx.match[1];
    await ctx.editMessageText(
        `👑 کدام پنل را می‌خواهید بسازید؟\n\nمخزن گیت‌هاب: luffy-sh-op/LUFFY_PANEL`,
        Markup.inlineKeyboard([
            [Markup.button.callback('👑 Luffy Panel (شروع ساخت)', `deploy_luffy_${tokenIndex}`)],
            [Markup.button.callback('🔙 بازگشت', 'build_panel')]
        ])
    );
});

bot.action(/deploy_luffy_(\d+)/, async (ctx) => {
    const userId = ctx.from.id;
    const tokenIndex = ctx.match[1];
    const db = loadData();
    const userTokenObj = db.tokens[userId] ? db.tokens[userId][tokenIndex] : null;

    if (!userTokenObj) {
        return ctx.answerCbQuery('خطا: توکن یافت نشد!', { show_alert: true });
    }

    await deployLuffyPanelToRailway(userTokenObj, ctx);
});

bot.launch().then(() => {
    console.log('KIA Nex Bot is running successfully!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
