import { Markup, Scenes, Telegraf } from 'telegraf';
import { SceneGenerator } from './src/scenes/scenes';
import { MySceneContext } from './src/models/context.interface';
import LocalSession from 'telegraf-session-local';
import { IConfigService } from './src/models/config.interface';
import { ConfigService } from './src/config/config.service';
import { MongoClient, ServerApiVersion } from 'mongodb';
import express from 'express';
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
      this.sceneGenerator.greetingScene(),
      this.sceneGenerator.nameScene(),
      this.sceneGenerator.ageScene(),
      this.sceneGenerator.genderScene(),
      this.sceneGenerator.lookingForScene(),
      this.sceneGenerator.AboutScene(),
      this.sceneGenerator.locationScene(),
      this.sceneGenerator.photoScene(),
      this.sceneGenerator.eventMenuScene(),
      this.sceneGenerator.eventNameScene(),
      this.sceneGenerator.eventTimeScene(),
      this.sceneGenerator.eventAboutScene(),
      this.sceneGenerator.eventLookigForScene(),
      // this.sceneGenerator.eventAgeRangeScene(),
      this.sceneGenerator.eventListScene(),
      this.sceneGenerator.lookForMatchScene(),
      this.sceneGenerator.userFormScene(),
      this.sceneGenerator.userFormEditScene(),
      this.sceneGenerator.donateScene(),
      this.sceneGenerator.helpScene(),
      this.sceneGenerator.moderateScene(),
      this.sceneGenerator.paymentScene()
    ],
    {
      ttl: 2592000,
    }
  );

  constructor(private readonly configService: IConfigService) {
    this.bot = new Telegraf(this.configService.get('TOKEN'));
    this.bot.use(new LocalSession({ database: 'sessions.json' }).middleware());
    this.bot.use(this.stage.middleware());
    app.use(express.json());
    app.get('/', (req, res) => {
      res.send('Hello, this is your Express app!');
    });
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
    this.bot.command('start', async (ctx) => {
      await ctx.reply(`Вітаємо в ком'юніті Crush! 👋🏻

💝 Crush — український бот знайомств, який наповнить твоє життя приємними моментами. Він допоможе тобі знайти компаньона на якусь подію або просто прогулянку в парку, а також знайти кохану людину, друга або подругу!
      
Команда crush’а міцно обійняла тебе🫂`);
      await ctx.scene.enter('greeting');
    });
    const regex = /^(.+):(\d+):(.+)$/;
    this.bot.action(regex, async (ctx) => {
      const actionType = ctx.match[1];
      const initiatorUserId = +ctx.match[2];
      const initiatorUsername = ctx.match[3];
      // const updatedKeyboard = {
      //   inline_keyboard: [
      //     [
      //       { text: '❤️', callback_data: 'liked', disabled: true },
      //       { text: '👎', callback_data: 'disliked', disabled: true },
      //     ],
      //   ],
      // };
      const username = ctx.from?.username;
      const userLink = `tg://user?id=${ctx.from!.id}`;
      const mentionMessage = username
        ? `@${username}`
        : `[${ctx.from?.first_name}](${userLink})`;
      try {
        if (actionType === 'likeEvent' || actionType === 'like') {
          await client.connect();
          const db = client.db('cluster0');
          const user = await db
            .collection('users')
            .findOne({ userId: ctx.from!.id });

          if (user) {
            const commonMessage = `Посилання на профіль ${mentionMessage}`;
            const userDetails = `🧘🏼*Краш:* ${user.username}, ${user.age}, ${
              user.location
            }${user.about ? `, ${user.about}` : ''}`;

            const message =
              actionType === 'likeEvent'
                ? `Твій краш прийняв твоє запрошення 😍\n${commonMessage}\n${userDetails}\nОбговори деталі та приємно проведіть цей час 🫶🏻`
                : `Твій краш відповів тобі взаємністю 😍\n${commonMessage}\n${userDetails}\nБажаю приємно провести час 🫶🏻`;

            await Promise.all([
              ctx.telegram.sendPhoto(initiatorUserId, user.photoId, {
                caption: message,
                parse_mode: 'Markdown',
              }),
              ctx.reply(
                `Посилання на профіль: ${initiatorUsername}\nБажаю весело провести час 👋`,
                Markup.keyboard([['👫 Звичайний пошук', '🍾 Події']])
                  .resize()
                  .oneTime()
              ),
              ctx.editMessageReplyMarkup(undefined),
            ]);
          }
        }
      } catch (error) {
        console.error('Error sending notification:', error);
      }
    });
    this.bot.action(/dislike(Event)?/, async (ctx) => {
      const actionType = ctx.match[1] ? 'dislikeEvent' : 'dislike';
      const message =
        actionType === 'dislikeEvent' ? 'пропозицію' : 'вподобайку';
      await ctx.reply(
        `Ти відхилив ${message}. Наступного разу точно пощастить 🤞🏻`,
        Markup.keyboard([['👫 Звичайний пошук', '🍾 Події']])
          .resize()
          .oneTime()
      );
      await ctx.editMessageReplyMarkup(undefined);
    });
    this.bot.hears('👫 Звичайний пошук', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    this.bot.hears('🍾 Події', async (ctx) => {
      await ctx.scene.enter('eventList');
    });
    this.bot.command('events', async (ctx) => {
      await ctx.scene.enter('eventList');
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
    this.bot.command('premium', async ctx => {
      await ctx.scene.enter('payment')
    })
    this.bot.command('donate', async (ctx) => {
     await ctx.scene.enter('donate');
    });
    this.bot.command('moderate', async (ctx) => {
      if (ctx.from.id === parseInt(this.configService.get('TG_MODERATOR_ID'), 10)) {
        await ctx.scene.enter('moderate');
      }
    });
    this.bot.on('message', (ctx) => ctx.reply('Спробуй /start'));
  }

  init() {
    this.bot.launch();
  }
}

const bot = new Bot(new ConfigService());

bot.init();
