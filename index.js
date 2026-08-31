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

// تابع خودکار برای کشف و استخراج workspaceId بدون نیاز به انتخاب کاربر
async function validateAndFetchWorkspace(token) {
    try {
        let email = 'user@railway.app';
        let workspaceId = null;

        // روش اول: بررسی از طریق me
        try {
            const meData = await railwayRequest(token, `
                query {
                    me {
                        email
                        name
                        workspaces { id name }
                    }
                }
            `);
            if (meData?.me) {
                email = meData.me.email || email;
                if (meData.me.workspaces && meData.me.workspaces.length > 0) {
                    workspaceId = meData.me.workspaces[0].id;
                }
            }
        } catch (_) {}

        // روش دوم: بررسی مستقیم لیست ورک‌اسپیس‌ها اگر مورد اول خالی بود
        if (!workspaceId) {
            try {
                const wsData = await railwayRequest(token, `
                    query {
                        workspaces { id name }
                    }
                `);
                if (wsData?.workspaces && wsData.workspaces.length > 0) {
                    workspaceId = wsData.workspaces[0].id;
                    email = 'Railway Workspace';
                }
            } catch (_) {}
        }

        // روش سوم (فال‌بک نهایی): اگر هیچ تیمی نبود، تلاش برای گرفتن پروژه‌ها جهت تایید اتصال توکن
        if (!workspaceId) {
            try {
                const projData = await railwayRequest(token, `
                    query {
                        projects { edges { node { id name } } }
                    }
                `);
                if (projData) {
                    workspaceId = 'PERSONAL_ACCOUNT'; // نشانگر حساب شخصی بدون تیم اجباری
                }
            } catch (_) {}
        }

        if (!workspaceId) {
            return { valid: false, error: 'توکن نامعتبر است یا به هیچ حساب/ورک‌اسپیسی دسترسی ندارد.' };
        }

        return {
            valid: true,
            email: email,
            workspaceId: workspaceId === 'PERSONAL_ACCOUNT' ? null : workspaceId
        };

    } catch (e) {
        return {
            valid: false,
            error: e.message || 'خطا در اعتبارسنجی توکن ریلی‌وی.'
        };
    }
}

// تابع دیپلوی کاملاً اتوماتیک و هوشمند
async function deployLuffyPanelToRailway(userTokenObj, ctx) {
    const token = userTokenObj.railwayToken;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    try {
        // گام ۱: ساخت پروژه به صورت خودکار
        await ctx.editMessageText('⏳ قدم ۱/۴: در حال ساخت خودکار پروژه در حساب ریلی‌وی شما...');

        const projectName = `KIA-Nex-Panel-${Date.now()}`;
        const projectInput = { name: projectName };
        
        // اگر ورک‌اسپیس شناسایی شده باشد، تیم‌اید اعمال می‌شود، وگرنه روی حساب شخصی ساخته می‌شود
        if (userTokenObj.workspaceId) {
            projectInput.teamId = userTokenObj.workspaceId;
        }

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
                variables: { input: projectInput }
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

        // گام ۲: دریافت Environment پیش‌فرض
        await ctx.editMessageText('⏳ قدم ۲/۴: در حال آماده‌سازی محیط اجرایی (Environment)...');

        let environmentId = project?.environments?.edges?.[0]?.node?.id || null;

        if (!environmentId) {
            const envRes = await railwayRequest(token, `
                query project($id: String!) {
                    project(id: $id) {
                        environments {
                            edges { node { id name } }
                        }
                    }
                }
            `, { id: projectId });

            environmentId = envRes?.project?.environments?.edges?.[0]?.node?.id || null;
        }

        if (!environmentId) {
            throw new Error('محیط پیش‌فرض Railway پیدا نشد.');
        }

        // گام ۳: اتصال خودکار مخزن گیت‌هاب لوفی پنل
        await ctx.editMessageText('⏳ قدم ۳/۴: در حال اتصال مخزن لوفی پنل (luffy-sh-op/LUFFY_PANEL)...');

        const serviceRes = await railwayRequest(token, `
            mutation serviceCreate($input: ServiceCreateInput!) {
                serviceCreate(input: $input) { id name }
            }
        `, {
            input: {
                projectId,
                environmentId,
                name: 'luffy-panel',
                source: { repo: 'luffy-sh-op/LUFFY_PANEL' }
            }
        });

        const serviceId = serviceRes?.serviceCreate?.id;
        if (!serviceId) {
            throw new Error('سرویس ساخته نشد یا Service ID دریافت نشد.');
        }

        // گام ۴: تنظیم پورت 8080 و ساخت دامنه اختصاصی
        await ctx.editMessageText('⏳ قدم ۴/۴: تنظیم پورت 8080 و ساخت دامنه اختصاصی...');

        try {
            await railwayRequest(token, `
                mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
                    variableCollectionUpsert(input: $input)
                }
            `, {
                input: {
                    projectId,
                    environmentId,
                    serviceId,
                    variables: { PORT: '8080' }
                }
            });
        } catch (err) {
            console.log('PORT variable warning:', err.message);
        }

        let domain = null;
        try {
            const domainRes = await railwayRequest(token, `
                mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
                    serviceDomainCreate(input: $input) { domain }
                }
            `, {
                input: { serviceId, environmentId }
            });
            domain = domainRes?.serviceDomainCreate?.domain || null;
        } catch (err) {
            console.log('Domain warning:', err.message);
        }

        if (!domain) {
            throw new Error('سرویس ساخته شد، اما Railway نتوانست دامنه بسازد.');
        }

        const panelLink = `https://${domain}/dashboard`;

        const successText = `🎉 پنل با موفقیت ساخته شد!

🚀 لوفی پنل شما آماده استفاده است.

🔗 لینک پنل:
${panelLink}

🔐 رمز عبور پنل:
admin

━━━━━━━━━━━━━━
⚡️ 𝑲𝑰𝑨 𝑵𝒆𝒙
💡 لطفاً رمز عبور خود را با دیگران به اشتراک نگذارید.
✅ با استفاده از لینک بالا وارد پنل شوید.`;

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
            `❌ خطا در ساخت پنل روی ریلی‌وی!\n\nجزئیات خطا: ${errorMsg}\n\n💡 لطفاً توکن معتبر ریلی‌وی ارسال کنید.`,
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
        ? userTokens.map((t, index) => `${index + 1}️⃣ توکن ریلی‌وی: ...${t.railwayToken.slice(-8)} | اکانت: ${t.email}`).join('\n')
        : '❌ هیچ توکن ریلی‌وی ثبت نشده است.';

    const text = `🔐 مدیریت توکن‌ها (Railway API Token)
در این بخش می‌توانید توکن ریلی‌وی خود را به‌سادگی ثبت، مدیریت یا حذف کنید.

➕ برای افزودن توکن جدید، گزینه ثبت توکن را انتخاب کنید.
🗑️ برای حذف توکن‌های قبلی، گزینه حذف توکن را بزنید.

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
        `➕ لطفاً **توکن حساب ریلی‌وی (Railway API Token)** خود را ارسال کنید:\n\n(ربات به صورت خودکار پروژه و دامین را می‌سازد)`,
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
        `🗑️ تمام توکن‌های ریلی‌وی شما با موفقیت حذف شدند.`,
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
            return ctx.reply('✅ ربات با موفقیت خاموش شد.');
        }
    }

    if (db.userStates[userId] === 'WAITING_FOR_RAILWAY_TOKEN') {
        db.userStates[userId] = null;
        saveData(db);

        const status = await validateAndFetchWorkspace(text);
        if (!status.valid) {
            return ctx.reply(`❌ توکن ریلی‌وی قابل استفاده نیست!\n\n${status.error}`, 
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

        return ctx.reply(`✅ توکن ریلی‌وی با موفقیت تأیید شد و اطلاعات اکانت ذخیره گردید!`,
            Markup.inlineKeyboard([
                [Markup.button.callback('🏗️ ساخت پنل', 'build_panel')],
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
    await ctx.reply('🟢 پنل با موفقیت فعال شد.');
});

bot.action('build_panel', async (ctx) => {
    const userId = ctx.from.id;
    const db = loadData();
    const userTokens = db.tokens[userId] || [];

    if (userTokens.length === 0) {
        return ctx.answerCbQuery('لطفا ابتدا از بخش مدیریت توکن، توکن ریلی‌وی ثبت کنید!', { show_alert: true });
    }

    const buttons = userTokens.map((t, idx) => [
        Markup.button.callback(`🔹 اکانت ${t.email} (...${t.railwayToken.slice(-6)})`, `select_token_${idx}`)
    ]);
    buttons.push([Markup.button.callback('🔙 بازگشت', 'main_menu')]);

    await ctx.editMessageText('🔑 لطفاً اکانت مدنظر خود را برای ساخت خودکار لوفی پنل انتخاب کنید:', Markup.inlineKeyboard(buttons));
});

bot.action(/select_token_(\d+)/, async (ctx) => {
    const tokenIndex = ctx.match[1];
    const userId = ctx.from.id;
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
