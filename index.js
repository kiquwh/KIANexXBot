const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// توکن اصلی ربات شما (می‌توانید از متغیرهای محیطی Railway هم بخوانید)
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const ADMIN_ID = 8854073031;

const bot = new Telegraf(BOT_TOKEN);

// مسیر ذخیره‌سازی داده‌ها روی Volume ریلی‌وی
const DATA_FILE = path.join(__dirname, 'data.json');

// ساختار اولیه دیتابیس ساده روی فایل (برای Volume ریلی‌وی)
function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = {
            tokens: {}, // userId -> [{ token, email }]
            botStatus: { active: true, reason: '' },
            userStates: {} // userId -> state
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// چک کردن معتبر بودن توکن ربات تلگرام و گرفتن ایمیل (از طریق متد getMe)
async function validateTelegramToken(token) {
    try {
        const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
        if (response.data && response.data.ok) {
            // تلگرام مستقیماً ایمیل نمی‌دهد، اما اطلاعات بات را می‌دهد. 
            // برای شبیه‌سازی یا دریافت ایمیل مرتبط، از ساختار بات استفاده می‌کنیم یا ایمیل پیشفرض امنیتی ثبت می‌کنیم
            return {
                valid: true,
                username: response.data.result.username,
                email: `${response.data.result.username}@bot.org`
            };
        }
    } catch (e) {
        return { valid: false };
    }
    return { valid: false };
}

// پیام خوش‌آمدگویی اصلی
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

// هندلر استارت
bot.start(async (ctx) => {
    const db = loadData();
    if (!db.botStatus.active && ctx.from.id !== ADMIN_ID) {
        return ctx.reply(`🔴 پنل موقتاً خاموش است\n\n📌 دلیل خاموشی:\n${db.botStatus.reason}`);
    }
    await ctx.reply(welcomeText, mainMenuKeyboard);
});

// دکمه مدیریت توکن
bot.action('manage_tokens', async (ctx) => {
    const userId = ctx.from.id;
    const db = loadData();
    const userTokens = db.tokens[userId] || [];

    let tokensListText = userTokens.length > 0 
        ? userTokens.map((t, index) => `${index + 1}️⃣ توکن: ...${t.token.slice(-10)} | ایمیل: ${t.email}`).join('\n')
        : '❌ هیچ توکنی ثبت نشده است.';

    const text = `🔐 مدیریت توکن‌ها
در این بخش می‌توانید توکن‌های خود را به‌سادگی ثبت، مدیریت یا حذف کنید.

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

// بازگشت به منوی اصلی
bot.action('main_menu', async (ctx) => {
    await ctx.editMessageText(welcomeText, mainMenuKeyboard);
});

// افزودن توکن جدید (درخواست ارسال توکن)
bot.action('add_token', async (ctx) => {
    const db = loadData();
    db.userStates[ctx.from.id] = 'WAITING_FOR_TOKEN';
    saveData(db);

    await ctx.editMessageText(
        `➕ لطفاً توکن ربات خود را ارسال کنید:\n\n(برای لغو روی بازگشت بزنید)`,
        Markup.inlineKeyboard([
            [Markup.button.callback('🔙 بازگشت', 'manage_tokens')]
        ])
    );
});

// حذف توکن‌ها
bot.action('delete_tokens', async (ctx) => {
    const userId = ctx.from.id;
    const db = loadData();
    db.tokens[userId] = [];
    saveData(db);

    await ctx.answerCbQuery('تمام توکن‌های قبلی حذف شد!');
    // رفرش صفحه مدیریت توکن
    return ctx.editMessageText(
        `🗑️ تمام توکن‌های شما با موفقیت حذف شدند.\n\n🔐 مدیریت توکن‌ها`,
        Markup.inlineKeyboard([
            [Markup.button.callback('➕ افزودن توکن جدید', 'add_token')],
            [Markup.button.callback('🔙 بازگشت', 'main_menu')]
        ])
    );
});

// دریافت پیام متنی کاربران (برای گرفتن توکن یا دلیل خاموشی ادمین)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const db = loadData();

    // پنل ادمین و دستورات مدیریت
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

            // ارسال پیام به همه کاربران (یا اطلاع‌رسانی)
            await ctx.reply('✅ ربات با موفقیت خاموش شد و پیام قطع برای کاربران اعمال گردید.');
            
            // در اینجا می‌توانید به کاربران ثبت شده در دیتابیس پیام هم ارسال کنید
            return;
        }
    }

    // حالت انتظار برای دریافت توکن ربات کاربر
    if (db.userStates[userId] === 'WAITING_FOR_TOKEN') {
        db.userStates[userId] = null;
        saveData(db);

        const status = await validateTelegramToken(text.trim());
        if (!status.valid) {
            return ctx.reply('❌ توکن نامعتبر است! لطفاً یک توکن معتبر از BotFather بفرستید.', 
                Markup.inlineKeyboard([[Markup.button.callback('🔙 بازگشت', 'manage_tokens')]])
            );
        }

        // ذخیره توکن
        if (!db.tokens[userId]) db.tokens[userId] = [];
        db.tokens[userId].push({
            token: text.trim(),
            email: status.email
        });
        saveData(db);

        return ctx.reply(`✅ توکن با موفقیت تایید شد!\n📧 ایمیل / شناسه شناسایی: ${status.email}`,
            Markup.inlineKeyboard([
                [Markup.button.callback('🔐 مدیریت توکن‌ها', 'manage_tokens')],
                [Markup.button.callback('🏠 بازگشت به منوی اصلی', 'main_menu')]
            ])
        );
    }
});

// مدیریت بخش ادمین: خاموش کردن
bot.action('admin_off', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const db = loadData();
    db.userStates[ADMIN_ID] = 'WAITING_FOR_OFF_REASON';
    saveData(db);
    await ctx.reply('⚠️ لطفاً دلیل خاموش کردن پنل را ارسال کنید:');
});

// مدیریت بخش ادمین: روشن کردن
bot.action('admin_on', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const db = loadData();
    db.botStatus.active = true;
    db.botStatus.reason = '';
    saveData(db);

    await ctx.reply('🟢 پنل با موفقیت فعال شد و به حالت عادی برگشت.');
});

// ساخت پنل
bot.action('build_panel', async (ctx) => {
    const userId = ctx.from.id;
    const db = loadData();
    const userTokens = db.tokens[userId] || [];

    if (userTokens.length === 0) {
        return ctx.answerCbQuery('لطفا ابتدا از گزینه مدیریت توکن، توکن ثبت کنید!', { show_alert: true });
    }

    // نمایش لیست توکن‌ها جهت انتخاب برای ساخت پنل
    const buttons = userTokens.map((t, idx) => [
        Markup.button.callback(`🔹 توکن شماره ${idx + 1} (...${t.token.slice(-6)})`, `select_token_${idx}`)
    ]);
    buttons.push([Markup.button.callback('🔙 بازگشت', 'main_menu')]);

    await ctx.editMessageText('🔑 لطفاً توکن مورد نظر خود را برای ساخت پنل انتخاب کنید:', Markup.inlineKeyboard(buttons));
});

// انتخاب توکن و نمایش لیست پنل‌ها
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

// استارت فرآیند ساخت و دیپلوی (شبیه‌سازی اتصال به گیت‌هاب و ریلی‌وی و ساخت دامین پورت 8080)
bot.action(/deploy_luffy_(\d+)/, async (ctx) => {
    await ctx.editMessageText('⏳ در حال اتصال به گیت‌هاب برای فورک مخزن و راه‌اندازی روی ریلی‌وی...');

    // شبیه‌سازی ساخت دامین و پورت 8080 روی Railway
    setTimeout(async () => {
        const randomId = Math.random().toString(36.substring(2, 8));
        const panelLink = `https://kia-nex-${randomId}.railway.app/dashboard`;

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
    }, 3000);
});

// اجرای ربات
bot.launch().then(() => {
    console.log('KIA Nex Bot is running successfully!');
});

// مدیریت خروج ایمن
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
