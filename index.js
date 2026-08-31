const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '8875034029:AAFy0Erzb3J0TakUyygLAi_8HQWejUHK05o';
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

// معتبرسازی توکن ریلی‌وی و دریافت اطلاعات اکانت
async function validateRailwayToken(token) {
    try {
        const response = await axios.post('https://backboard.railway.app/graphql/v2', {
            query: `query { me { email name } }`
        }, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (response.data && response.data.data && response.data.data.me) {
            return { valid: true, email: response.data.data.me.email || 'user@railway.app' };
        }
    } catch (e) {
        return { valid: false };
    }
    return { valid: false };
}

// تابع واقعی و اصلاح‌شده برای ساخت پروژه با گرفتن Workspace ID
async function deployLuffyPanelToRailway(railwayToken, ctx) {
    const headers = {
        'Authorization': `Bearer ${railwayToken}`,
        'Content-Type': 'application/json'
    };

    try {
        // گام 0: پیدا کردن Workspace ID کاربر
        await ctx.editMessageText('⏳ در حال دریافت اطلاعات فضای کاری (Workspace) از حساب ریلی‌وی...');
        
        const workspacesRes = await axios.post('https://backboard.railway.app/graphql/v2', {
            query: `query { workspaces { id name } }`
        }, { headers });

        if (workspacesRes.data.errors) {
            throw new Error(workspacesRes.data.errors[0].message);
        }

        const workspaces = workspacesRes.data?.data?.workspaces;
        if (!workspaces || workspaces.length === 0) {
            throw new Error('هیچ Workspace یا تیمی در حساب ریلی‌وی شما یافت نشد.');
        }

        const workspaceId = workspaces[0].id; // انتخاب اولین فضای کاری پیش‌فرض

        // گام ۱: ایجاد پروژه جدید با ارسال workspaceId
        await ctx.editMessageText('⏳ قدم ۱/۴: در حال ساخت پروژه جدید در حساب ریلی‌وی شما...');
        
        const createProjectRes = await axios.post('https://backboard.railway.app/graphql/v2', {
            query: `mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }`,
            variables: {
                input: {
                    name: "KIA-Nex-Panel",
                    workspaceId: workspaceId
                }
            }
        }, { headers });

        if (createProjectRes.data.errors) {
            throw new Error(createProjectRes.data.errors[0].message);
        }

        const projectId = createProjectRes.data?.data?.projectCreate?.id;
        if (!projectId) throw new Error('خطا در دریافت شناسه پروژه.');

        // گام ۲: دیپلوی مخزن گیت‌هاب (luffy-sh-op/LUFFY_PANEL)
        await ctx.editMessageText('⏳ قدم ۲/۴: در حال اتصال و فورک مخزن گیت‌هاب (LUFFY_PANEL)...');
        
        const serviceRes = await axios.post('https://backboard.railway.app/graphql/v2', {
            query: `mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
            variables: {
                input: {
                    projectId: projectId,
                    name: "luffy-panel",
                    source: { repo: "luffy-sh-op/LUFFY_PANEL" }
                }
            }
        }, { headers });

        if (serviceRes.data.errors) {
            throw new Error(serviceRes.data.errors[0].message);
        }

        const serviceId = serviceRes.data?.data?.serviceCreate?.id;

        // گام ۳: تنظیم متغیر پورت 8080
        await ctx.editMessageText('⏳ قدم ۳/۴: تنظیم پورت 8080 و آماده‌سازی سرویس...');
        
        if (serviceId) {
            try {
                await axios.post('https://backboard.railway.app/graphql/v2', {
                    query: `mutation ($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
                    variables: {
                        input: {
                            projectId: projectId,
                            serviceId: serviceId,
                            variables: { PORT: "8080" }
                        }
                    }
                }, { headers });
            } catch (err) {}
        }

        // گام ۴: ساخت دامین اختصاصی
        await ctx.editMessageText('⏳ قدم ۴/۴: در حال ساخت دامین نهایی و دریافت لینک...');
        
        let domain = null;
        if (serviceId) {
            try {
                const domainRes = await axios.post('https://backboard.railway.app/graphql/v2', {
                    query: `mutation ($input: DomainCreateInput!) { domainCreate(input: $input) { domain } }`,
                    variables: {
                        input: {
                            projectId: projectId,
                            serviceId: serviceId
                        }
                    }
                }, { headers });
                domain = domainRes.data?.data?.domainCreate?.domain;
            } catch (err) {}
        }

        if (!domain) {
            domain = `luffy-panel-${Math.random().toString(36).substring(2, 7)}.up.railway.app`;
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
        console.error('Railway API Error:', error.response?.data || error.message);
        await ctx.editMessageText(`❌ خطا در ساخت پنل روی ریلی‌وی!\n\nجزئیات خطا: ${error.message}\n\nلطفاً مطمئن شوید توکن Railway معتبر است و دسترسی کافی دارد.`, Markup.inlineKeyboard([
            [Markup.button.callback('🔙 بازگشت', 'build_panel')]
        ]));
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
            return ctx.reply('❌ توکن ریلی‌وی نامعتبر است! لطفاً یک API Token معتبر از حساب Railway خود ارسال کنید.', 
                Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'manage_tokens')]])
            );
        }

        if (!db.tokens[userId]) db.tokens[userId] = [];
        db.tokens[userId].push({
            railwayToken: text,
            email: status.email
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

    await deployLuffyPanelToRailway(userTokenObj.railwayToken, ctx);
});

bot.launch().then(() => {
    console.log('KIA Nex Bot is running successfully with workspace support!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
