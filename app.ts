import { Markup, Scenes, Telegraf, session } from 'telegraf';
import { SceneGenerator } from './src/scenes/scenes';
import { MySceneContext } from './src/models/context.interface';
//import LocalSession from 'telegraf-session-local';
import { IConfigService } from './src/models/config.interface';
import { ConfigService } from './src/config/config.service';
import { MongoClient, ServerApiVersion } from 'mongodb';
import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import { UserFormModel } from './src/models/userForm.schema';

const configService = new ConfigService();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const app = express();
const uri = configService.get('DB_KEY');
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const SUBSCRIPTION_DURAION_1MONTH = 60 * 60 * 1000; // 1 hour
const SUBSCRIPTION_DURAION_6MONTHS = 60 * 60 * 2 * 1000; // 2 hour
const SUBSCRIPTION_DURAION_1YEAR = 60 * 60 * 3 * 1000; // 3 hour

async function run() {
  try {
    await client.connect();
    const db = client.db('cluster0');
    await db.command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
    await db
      .collection('viewed_profiles')
      .createIndex({ expiryTimestamp: 1 }, { expireAfterSeconds: 0 });
    await db
      .collection('bans')
      .createIndex({ banExpirationDate: 1 }, { expireAfterSeconds: 0 });
  } finally {
    await client.close();
  }
}
run().catch(console.dir);

class Bot {
  bot: Telegraf<MySceneContext>;
  sceneGenerator = new SceneGenerator(client, this.configService);
  stage = new Scenes.Stage<MySceneContext>(
    [
      this.sceneGenerator.nameScene(),
      this.sceneGenerator.ageScene(),
      this.sceneGenerator.genderScene(),
      this.sceneGenerator.lookingForScene(),
      this.sceneGenerator.lookingForAgeScene(),
      this.sceneGenerator.AboutScene(),
      this.sceneGenerator.socialLinksScene(),
      this.sceneGenerator.locationScene(),
      this.sceneGenerator.photoScene(),
      this.sceneGenerator.eventMenuScene(),
      this.sceneGenerator.eventNameScene(),
      this.sceneGenerator.eventTimeScene(),
      this.sceneGenerator.eventAboutScene(),
      this.sceneGenerator.eventLookigForScene(),
      this.sceneGenerator.eventLocationScene(),
      // this.sceneGenerator.eventAgeRangeScene(),
      this.sceneGenerator.eventListScene(),
      this.sceneGenerator.lookForMatchScene(),
      this.sceneGenerator.complaintScene(),
      this.sceneGenerator.likeArchiveScene(),
      this.sceneGenerator.userFormScene(),
      this.sceneGenerator.userFormEditScene(),
      this.sceneGenerator.profileEditScene(),
      this.sceneGenerator.lookForMatchEditScene(),
      this.sceneGenerator.donateScene(),
      this.sceneGenerator.helpScene(),
      this.sceneGenerator.moderateScene(),
      this.sceneGenerator.showPremiumBenefitsScene(),
      this.sceneGenerator.choosePremiumPeriodScene(),
      this.sceneGenerator.promocodeScene(),
      this.sceneGenerator.premiumSettingsScene(),
      this.sceneGenerator.botEventListScene(),
      this.sceneGenerator.botEventLookingForScene(),
      this.sceneGenerator.eventChooseScene(),
      this.sceneGenerator.botEventNameScene(),
      this.sceneGenerator.botEventTimeScene(),
      this.sceneGenerator.botEventAboutScene(),
      this.sceneGenerator.botEventLocationScene(),
      this.sceneGenerator.botEventPhotoScene(),
      this.sceneGenerator.referralScene(),
      this.sceneGenerator.premiumVideoScene(),
      this.sceneGenerator.givePremiumForVideoScene(),
    ],
    {
      ttl: 2592000,
    }
  );

  async handlePremiumPayment(req: express.Request, res: express.Response) {
    const data = req.body;

    const dataString = JSON.stringify(data);
    const orderReference = dataString.match(
      /"orderReference\\":\\"(ORDER_\d+_(\d+)_(\d [a-z]+))\\"/
    );
    const status = 'accept';
    const time = Math.floor(Date.now() / 1000);
    const transactionStatusMatch = dataString.match(
      /"transactionStatus.":."([^"]+)\\"/
    );
    console.log(data);
    if (orderReference && transactionStatusMatch) {
      const userId = +orderReference[2];
      const subscriptionPeriod = orderReference[3];
      const concatenatedString = `${orderReference[1]};${status};${time}`;
      const signature = crypto
        .createHmac('md5', this.configService.get('MERCHANT_SECRET_KEY'))
        .update(concatenatedString, 'utf-8')
        .digest('hex');

      const responseObject = {
        orderReference: orderReference[1],
        status,
        time,
        signature,
      };
      console.log(JSON.stringify(responseObject));
      res.json(responseObject);
      if (transactionStatusMatch[1] === 'Approved') {
        let subscriptionDurationMs = 0;
        let subscriptionPeriodUa = '';
        switch (subscriptionPeriod) {
          case '1 month':
            subscriptionDurationMs = SUBSCRIPTION_DURAION_1MONTH;
            subscriptionPeriodUa = '1 місяць';
            break;
          case '6 months':
            subscriptionDurationMs = SUBSCRIPTION_DURAION_6MONTHS;
            subscriptionPeriodUa = '6 місяців';
            break;
          case '1 year':
            subscriptionDurationMs = SUBSCRIPTION_DURAION_1YEAR;
            subscriptionPeriodUa = '1 рік';
            break;
          default:
            return 0;
        }
        const premiumEndTime = new Date();
        premiumEndTime.setTime(
          premiumEndTime.getTime() + subscriptionDurationMs
        );
        await client.connect();
        const db = client.db('cluster0');
        await db.collection('users').updateOne(
          { userId: userId },
          {
            $set: {
              isPremium: true,
              premiumEndTime: premiumEndTime,
              likesSentCount: 0,
            },
          }
        );
        const currentMonth = new Date().getMonth() + 1;
        await db.collection('payments').updateOne(
          { subscriptionPeriodUa },
          {
            $inc: { numberOfPayments: 1 },
            $set: { currentMonth, subscriptionPeriodUa },
          },
          { upsert: true }
        );
        this.bot.telegram.sendMessage(
          userId,
          `В тебе тепер є преміум на ${subscriptionPeriodUa}`
        );
      }
      // else {
      //   console.log(transactionStatusMatch[1]);
      //   if (transactionStatusMatch[1] !== 'Refunded') {
      //     this.bot.telegram.sendMessage(
      //       userId,
      //       'Упс, схоже щось пішло не так. Спробуй потім'
      //     );
      //   }
      // }
    }
  }

  constructor(private readonly configService: IConfigService) {
    this.bot = new Telegraf(this.configService.get('TOKEN'));
    this.bot.use(session());
    // this.bot.use(new LocalSession({ database: 'sessions.json' }).middleware());
    this.bot.use(this.stage.middleware());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.get('/', (req, res) => {
      res.send('Hello, this is your Express app!');
    });
    app.get('/healthz', (req, res) => {
      res.status(200).send('OK');
    });
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
    this.bot.command('start', async (ctx) => {
      await ctx.reply(`Вітаємо в ком'юніті Crush! 👋🏻

💝 Crush — український проєкт, який наповнить твоє життя приємними моментами. Він допоможе тобі знайти ідеального компаньйона для будь-якої події та активностей. А можливо, саме тут ти знайдеш собі нового друга або подругу для незабутніх спільних моментів!
      
Команда Crush’а міцно обійняла тебе🫂
      `);
      await client.connect();
      const db = client.db('cluster0');
      const userForm = await db
        .collection('users')
        .findOne({ userId: ctx.from.id });
      if (!ctx.session.userForm) {
        ctx.session.userForm = new UserFormModel({});
      }
      Object.assign(ctx.session.userForm, userForm);
      if (userForm) {
        await ctx.reply('⬇️⁣');
      } else {
        await ctx.reply(
          '⬇️⁣',
          Markup.keyboard([['👤 Створити профіль']])
            .oneTime()
            .resize()
        );
        try {
          const referralToken = ctx.message.text.split(' ')[1];
          if (referralToken) {
            const referrerUser = await db
              .collection('users')
              .findOne({ referralToken: referralToken });
            if (referrerUser) {
              ctx.session.userForm.referrerUserId = referrerUser.userId;
            }
          }
        } catch (error) {
          console.error('Error detecting user token');
        }
      }
    });
    // const regex = /^(.+):(\d+):(.+)$/;
    // this.bot.action(regex, async (ctx) => {
    //   const actionType = ctx.match[1];
    //   const initiatorUserId = +ctx.match[2];
    //   const initiatorUsername = ctx.match[3];
    //   // const updatedKeyboard = {
    //   //   inline_keyboard: [
    //   //     [
    //   //       { text: '❤️', callback_data: 'liked', disabled: true },
    //   //       { text: '👎', callback_data: 'disliked', disabled: true },
    //   //     ],
    //   //   ],
    //   // };
    //   const username = ctx.from?.username;
    //   const userLink = `tg://user?id=${ctx.from!.id}`;
    //   const mentionMessage = username
    //     ? `@${username}`
    //     : `[${ctx.from?.first_name}](${userLink})`;
    //   try {
    //     if (actionType === 'likeEvent' || actionType === 'like') {
    //       await client.connect();
    //       const db = client.db('cluster0');
    //       const user = await db
    //         .collection('users')
    //         .findOne({ userId: ctx.from!.id });

    //       if (user) {
    //         const commonMessage = `Посилання на профіль ${mentionMessage}`;
    //         const userDetails = `🧘🏼*Краш:* ${user.username}, ${user.age}, ${
    //           user.location
    //         }${user.about ? `, ${user.about}` : ''}`;

    //         const message =
    //           actionType === 'likeEvent'
    //             ? `Твій краш прийняв твоє запрошення 😍\n${commonMessage}\n${userDetails}\nОбговори деталі та приємно проведіть цей час 🫶🏻`
    //             : `Твій краш відповів тобі взаємністю 😍\n${commonMessage}\n${userDetails}\nБажаю приємно провести час 🫶🏻`;

    //         await Promise.all([
    //           ctx.telegram.sendPhoto(initiatorUserId, user.photoId, {
    //             caption: message,
    //             parse_mode: 'Markdown',
    //           }),
    //           ctx.reply(
    //             `Посилання на профіль: ${initiatorUsername}\nБажаю весело провести час 👋`,
    //             Markup.keyboard([['👫 Звичайний пошук', '🍾 Події']])
    //               .resize()
    //               .oneTime()
    //           ),
    //           await db.collection('users').updateOne(
    //             { userId: user.userId },
    //             {
    //               $set: {
    //                 lastActive: new Date().toLocaleString(),
    //               },
    //             }
    //           ),
    //           ctx.editMessageReplyMarkup(undefined),
    //         ]);
    //       }
    //     }
    //   } catch (error) {
    //     console.error('Error sending notification:', error);
    //   }
    // });
    // this.bot.action(/dislike(Event)?/, async (ctx) => {
    //   const actionType = ctx.match[1] ? 'dislikeEvent' : 'dislike';
    //   const message =
    //     actionType === 'dislikeEvent' ? 'пропозицію' : 'вподобайку';
    //   await ctx.reply(
    //     `Ти відхилив ${message}. Наступного разу точно пощастить 🤞🏻`,
    //     Markup.keyboard([['👫 Звичайний пошук', '🍾 Події']])
    //       .resize()
    //       .oneTime()
    //   );
    //   await client.connect();
    //   const db = client.db('cluster0');
    //   await db.collection('users').updateOne(
    //     { userId: ctx.from!.id },
    //     {
    //       $set: {
    //         lastActive: new Date().toLocaleString(),
    //       },
    //     }
    //   ),
    //     await ctx.editMessageReplyMarkup(undefined);
    // });
    this.bot.hears('👤 Створити профіль', async (ctx) => {
      await ctx.scene.enter('userform');
    });
    this.bot.hears('👫 Звичайний пошук', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    this.bot.hears('🍾 Події', async (ctx) => {
      await ctx.scene.enter('eventChoose');
    });
    this.bot.command('events', async (ctx) => {
      await ctx.scene.enter('eventChoose');
    });
    this.bot.command('people', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    this.bot.command('help', async (ctx) => {
      await ctx.scene.enter('help');
    });
    this.bot.command('profile', async (ctx) => {
      await ctx.scene.enter('userform');
    });
    this.bot.command('premium', async (ctx) => {
      await ctx.scene.enter('premiumBenefits');
    });
    this.bot.command('code', async (ctx) => {
      await ctx.scene.enter('promocode');
    });
    this.bot.command('referral', async (ctx) => {
      await ctx.scene.enter('referral');
    });
    this.bot.hears('🗄 Перейти у архів', async (ctx) => {
      await ctx.scene.enter('likeArchive');
    });
    this.bot.command('premiumTest', async () => {
      // TEST FUNC DELETE IN PROD!!!!!
      const subscriptionDurationMs = 60 * 5 * 1000; //5 min
      const premiumEndTime = new Date();
      premiumEndTime.setTime(premiumEndTime.getTime() + subscriptionDurationMs);
      await client.connect();
      const db = client.db('cluster0');
      await db.collection('users').updateOne(
        { userId: this.configService.get('TG_MODERATOR_ID') },
        {
          $set: {
            isPremium: true,
            premiumEndTime: premiumEndTime,
            likesSentCount: 0,
          },
        }
      );
      await this.bot.telegram.sendMessage(
        this.configService.get('TG_MODERATOR_ID'),
        'В тебе тепер є преміум'
      );
    });
    this.bot.command('donate', async (ctx) => {
      await ctx.scene.enter('donate');
    });
    this.bot.command('moderate', async (ctx) => {
      if (
        ctx.from.id === parseInt(this.configService.get('TG_MODERATOR_ID'), 10)
      ) {
        await ctx.scene.enter('moderate');
      }
    });
    this.bot.command('createEvent', async (ctx) => {
      if (
        ctx.from.id === parseInt(this.configService.get('TG_MODERATOR_ID'), 10)
      ) {
        await ctx.scene.enter('botEventName');
      }
    });
    this.bot.on('message', (ctx) => ctx.reply('Спробуй /start'));
  }

  init() {
    this.bot.launch({ dropPendingUpdates: true });
    app.post('/premium', this.handlePremiumPayment.bind(this));
  }
}

const bot = new Bot(new ConfigService());

bot.init();
