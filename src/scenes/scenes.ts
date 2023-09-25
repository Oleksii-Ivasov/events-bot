import { Markup, Scenes } from 'telegraf';
import { MySceneContext } from '../models/context.interface';
import { UserForm } from '../models/userForm.interface';
import { UserFormModel } from '../models/userForm.schema';
import { Db, MongoClient } from 'mongodb';
import axios from 'axios';
import { IConfigService } from '../models/config.interface';
import { Event } from '../models/event.interface';
import { EventModel } from '../models/event.schema';
import Fuse from 'fuse.js';
import fs from 'fs';
import crypto from 'crypto';
import cron from 'node-cron';
import { MediaGroup } from 'telegraf/typings/telegram-types';
import { Match } from '../models/match.interface';

const MAX_LIKES_LIMIT = 10;
const TIME_TO_VIEW_EXPIRE = 60 * 1000; // 1 minute
const INACTIVE_USER_TIME = 60 * 60 * 2 * 1000; // 2 hour
const SUBSCRIPTION_DURAION_1MONTH = 60 * 60 * 1000; // 1 hour
const SUBSCRIPTION_DURAION_6MONTHS = 60 * 60 * 2 * 1000; // 2 hour
const SUBSCRIPTION_DURAION_1YEAR = 60 * 60 * 3 * 1000; // 3 hour
const FIRST_BAN_TIME = 60 * 60 * 1000; // 1 hour
const SECOND_BAN_TIME = 60 * 60 * 2 * 1000; // 2 hour
const PERMANENT_BAN_TIME = 60 * 60 * 60 * 60 * 1000;
const SUBSCRIPTION_DURATION_TEST = 60 * 60 * 1000; // 1 hour

export class SceneGenerator {
  private db!: Db;
  private isConnectionOpened = false;
  constructor(
    private readonly client: MongoClient,
    private configService: IConfigService
  ) {
    this.connectToMongoDB();
    cron.schedule('0 */2 * * *', async () => {
      // every 2 hours check
      try {
        if (!this.isConnectionOpened) {
          await this.client.connect();
        }
        const currentDate = new Date();
        const inactiveThreshold = INACTIVE_USER_TIME; // 2 hours

        console.log('scheduler connected');
        const users = await this.db.collection('users').find().toArray(); // the line where error happens
        for (const user of users) {
          const lastActiveTimestamp = new Date(user.lastActive).getTime();
          const inactiveDuration = currentDate.getTime() - lastActiveTimestamp;
          if (inactiveDuration >= inactiveThreshold) {
            axios.post(
              `https://api.telegram.org/bot${this.configService.get(
                'TOKEN'
              )}/sendMessage`,
              {
                chat_id: user.userId,
                text: 'Тебе давно не було тут',
              }
            );
          }
        }
        const usersToResetLikes = await this.db
          .collection('users')
          .find({
            isPremium: false,
            likesSentCount: { $gt: 0 },
          })
          .toArray();
        for (const user of usersToResetLikes) {
          await this.db
            .collection('users')
            .updateOne(
              { userId: user.userId },
              { $set: { likesSentCount: 0 } }
            );
        }
        const usersToCheck = await this.db
          .collection('users')
          .find({
            isPremium: true,
            premiumEndTime: { $lte: currentDate },
          })
          .toArray();
        for (const user of usersToCheck) {
          axios.post(
            `https://api.telegram.org/bot${this.configService.get(
              'TOKEN'
            )}/sendMessage`,
            {
              chat_id: user.userId,
              text: 'Преміум закінчився',
            }
          );
          await this.db.collection('users').updateOne(
            { userId: user.userId },
            {
              $set: {
                isPremium: false,
                premiumEndTime: null,
              },
            }
          );
        }
      } catch (error) {
        console.error('Error while running main scheduler: ', error);
      }
    });
  }
  private async connectToMongoDB() {
    try {
      await this.client.connect();
      this.db = this.client.db('cluster0');
      this.client.on('open', () => {
        this.isConnectionOpened = true;
      });
    } catch (error) {
      console.error('Error connecting to MongoDB:', error);
    }
  }
  API_KEY = this.configService.get('API_KEY');
  event: Event = {
    userId: NaN,
    eventId: NaN,
    eventName: '',
    date: '',
    about: undefined,
    lookingFor: '',
    location: ''
    //ageRange: '',
  };

  nameScene(): Scenes.BaseScene<MySceneContext> {
    const name = new Scenes.BaseScene<MySceneContext>('name');
    name.enter(async (ctx) => {
      if (ctx.session.userForm.username) {
        await ctx.reply(
          'Як до тебе звертатись?',
          Markup.keyboard([[ctx.session.userForm.username]])
            .oneTime()
            .resize()
        );
      } else {
        await ctx.reply('Як до тебе звертатись?', Markup.removeKeyboard());
      }
    });
    this.addCommands(name);
    name.on('text', async (ctx) => {
      ctx.session.userForm.userId = ctx.from.id;
      ctx.session.userForm.username = ctx.message.text;
      await ctx.scene.enter('age');
    });
    name.on('message', async (ctx) => {
      await ctx.reply("Давай краще ім'я");
    });

    return name;
  }
  ageScene(): Scenes.BaseScene<MySceneContext> {
    const age = new Scenes.BaseScene<MySceneContext>('age');
    age.enter(async (ctx) => {
      if (ctx.session.userForm.age) {
        await ctx.reply(
          'Скільки тобі років?',
          Markup.keyboard([[ctx.session.userForm.age.toString()]])
            .oneTime()
            .resize()
        );
      } else {
        await ctx.reply('Скільки тобі років?');
      }
    });
    this.addCommands(age);
    age.on('text', async (ctx) => {
      ctx.session.userForm.age = Number(ctx.message.text);
      if (ctx.session.userForm.age && ctx.session.userForm.age > 0) {
        await ctx.scene.enter('location');
      } else if (!ctx.session.userForm.age) {
        await ctx.reply('Вкажи вік цифрами');
      } else if (ctx.session.userForm.age <= 0) {
        await ctx.reply('Вік має бути більше 0');
      }
    });
    age.on('message', async (ctx) => {
      ctx.reply('Давай краще вік');
    });
    return age;
  }
  genderScene(): Scenes.BaseScene<MySceneContext> {
    const gender = new Scenes.BaseScene<MySceneContext>('gender');
    gender.enter(async (ctx) => {
      const user = await this.getUserFormDataFromDatabase(ctx.from!.id);
      if (!user) {
        ctx.session.userForm = new UserFormModel({});
      } else {
        Object.assign(ctx.session.userForm, user);
      }
      await ctx.reply(
        'Давай створимо твою анкету. Якої ти статі?',
        Markup.keyboard([['Хлопець', 'Дівчина']]).resize()
      );
    });
    this.addCommands(gender);
    gender.hears('Хлопець', async (ctx) => {
      ctx.session.userForm.gender = 'male';
      await ctx.scene.enter('lookingFor');
    });
    gender.hears('Дівчина', async (ctx) => {
      ctx.session.userForm.gender = 'female';
      await ctx.scene.enter('lookingFor');
    });
    gender.on('message', async (ctx) => {
      await ctx.reply(
        'Будь-ласка, обери стать',
        Markup.keyboard([['Хлопець', 'Дівчина']]).resize()
      );
    });
    return gender;
  }
  lookingForScene(): Scenes.BaseScene<MySceneContext> {
    const lookingFor = new Scenes.BaseScene<MySceneContext>('lookingFor');
    lookingFor.enter(async (ctx) => {
      await ctx.reply(
        'Кого шукаєш?',
        Markup.keyboard([['Хлопці', 'Дівчата', 'Неважливо']]).resize()
      );
    });
    this.addCommands(lookingFor);
    lookingFor.hears('Хлопці', async (ctx) => {
      ctx.session.userForm.lookingFor = 'male';
      await ctx.scene.enter('name');
    });
    lookingFor.hears('Дівчата', async (ctx) => {
      ctx.session.userForm.lookingFor = 'female';
      await ctx.scene.enter('name');
    });
    lookingFor.hears('Неважливо', async (ctx) => {
      ctx.session.userForm.lookingFor = 'both';
      await ctx.scene.enter('name');
    });
    lookingFor.on('message', async (ctx) => {
      await ctx.reply('Обери хто тебе цікавить');
    });
    return lookingFor;
  }
  AboutScene(): Scenes.BaseScene<MySceneContext> {
    const about = new Scenes.BaseScene<MySceneContext>('about');
    about.enter(async (ctx) => {
      const isPremiumUser = ctx.session.userForm.isPremium;
      const hasAbout = ctx.session.userForm.about !== undefined;
      const premiumMessage = isPremiumUser ? ' або запиши голосове' : '';
      const defaultMessage = `Напиши пару слів про себе: що полюбляєш, кого шукаєш${premiumMessage}`;
      const keyboardOptions = hasAbout
        ? ['Пропустити', 'Залишити як є']
        : ['Пропустити'];
      await ctx.reply(
        defaultMessage,
        Markup.keyboard(keyboardOptions).oneTime().resize()
      );
    });
    this.addCommands(about);
    about.hears('Залишити як є', async (ctx) => {
      await ctx.scene.enter('socialLinks');
    });
    about.hears('Пропустити', async (ctx) => {
      ctx.session.userForm.about = undefined;
      await ctx.scene.enter('socialLinks');
    });
    about.on('voice', async (ctx) => {
      if (!ctx.session.userForm.isPremium) {
        await ctx.reply('Голосові можуть записувати лише преміум користувачі');
      } else {
        ctx.session.userForm.about = {
          type: 'voice',
          content: ctx.message.voice.file_id,
        };
        ctx.scene.enter('socialLinks');
      }
    });
    about.on('text', async (ctx) => {
      const userAbout = ctx.message.text;
      if (userAbout.length > 300) {
        await ctx.reply('Занадто велике повідомлення, зроби трохи меншим');
      } else {
        ctx.session.userForm.about = {
          type: 'text',
          content: userAbout,
        };
        ctx.scene.enter('socialLinks');
      }
    });
    about.on('message', async (ctx) => {
      await ctx.reply('Будь-ласка, напиши про себе');
    });
    return about;
  }

  socialLinksScene(): Scenes.BaseScene<MySceneContext> {
    const socialLinks = new Scenes.BaseScene<MySceneContext>('socialLinks');
    let inst = '';
    let tiktok = '';
    let isInstField = false;
    let isTikTokField = false;
    let links: string[] = [];
    socialLinks.enter(async (ctx) => {
      isInstField = false;
      isTikTokField = false;
      inst = '';
      tiktok = '';
      links = [];
      const upperKeyboard = [];
      const lowerKeyboard = [];
      if (
        ctx.session.userForm.socialLinks &&
        ctx.session.userForm.socialLinks.length > 0
      ) {
        upperKeyboard.push('Залишити як є');
      }
      if (!inst) {
        lowerKeyboard.push('Instagram');
      }
      if (!tiktok) {
        lowerKeyboard.push('TikTok');
      }
      upperKeyboard.push('Пропустити');
      await ctx.reply(
        'Можеш залишити посилання на свою соцмережу (преміум-користувачі можуть залишати до 2 посилань)',
        Markup.keyboard([upperKeyboard, lowerKeyboard]).oneTime().resize()
      );
    });
    socialLinks.hears('Пропустити', async (ctx) => {
      ctx.session.userForm.socialLinks = links;
      await ctx.scene.enter('photo');
    });
    socialLinks.hears('Залишити як є', async (ctx) => {
      await ctx.scene.enter('photo');
    });
    socialLinks.hears('Це все, зберегти', async (ctx) => {
      ctx.session.userForm.socialLinks = links;
      await ctx.scene.enter('photo');
    });
    socialLinks.hears('Instagram', async (ctx) => {
      isInstField = true;
      isTikTokField = false;
      await ctx.reply('Тепер вкажи свій нікнейм в Instagram');
    });
    socialLinks.hears('TikTok', async (ctx) => {
      isTikTokField = true;
      isInstField = false;
      await ctx.reply('Тепер вкажи свій нікнейм в TikTok');
    });
    this.addCommands(socialLinks);
    socialLinks.on('text', async (ctx) => {
      const availableLinks = ctx.session.userForm.isPremium ? 2 : 1;

      if (ctx.message.text.length > 300) {
        await ctx.reply('Занадто багато тексту, як для посилань');
      } else {
        let linkText = '';
        if (isInstField) {
          inst = `https://www.instagram.com/${ctx.message.text}`;
          linkText = `[Instagram](${inst})`;
        } else if (isTikTokField) {
          tiktok = `https://www.tiktok.com/@${ctx.message.text}`;
          linkText = `[TikTok](${tiktok})`;
        }
        links.push(linkText);
        await ctx.reply('✅ Посилання додано');
        if (links.length < availableLinks) {
          const keyboard = [];
          if (!inst) {
            keyboard.push('Instagram');
          }
          if (!tiktok) {
            keyboard.push('TikTok');
          }
          keyboard.push('Це все, зберегти');
          await ctx.reply(
            'Залиште ще посилання або натисніть "Це все, зберегти".',
            Markup.keyboard([keyboard]).oneTime().resize()
          );
        } else {
          ctx.session.userForm.socialLinks = links;
          await ctx.scene.enter('photo');
        }
      }
    });
    socialLinks.on('message', async (ctx) => {
      await ctx.reply(
        'За бажанням, залиш посилання на свою соцмережу (преміум-користувачі можуть залишати до 3 посилань)',
        Markup.keyboard(['Пропустити']).oneTime().resize()
      );
    });
    return socialLinks;
  }

  locationScene(): Scenes.BaseScene<MySceneContext> {
    const location = new Scenes.BaseScene<MySceneContext>('location');
    location.enter(async (ctx) => {
      if (ctx.session.userForm.location) {
        await ctx.reply(
          'З якого ти міста?',
          Markup.keyboard([
            `${ctx.session.userForm.location}`,
            Markup.button.locationRequest('Відправити місцезнаходження'),
          ])
            .oneTime()
            .resize()
        );
      } else {
        await ctx.reply(
          'З якого ти міста?',
          Markup.keyboard([
            Markup.button.locationRequest('Відправити місцезнаходження'),
          ])
            .oneTime()
            .resize()
        );
      }
    });
    this.addCommands(location);
    location.on('location', async (ctx) => {
      try {
        ctx.session.userForm.coordinates = ctx.message.location;
        const userLocationName = await this.getUserCityFromCoordinates(
          ctx.session.userForm.coordinates.latitude,
          ctx.session.userForm.coordinates.longitude
        );
        ctx.session.userForm.actualLocation = userLocationName.toLowerCase();
        ctx.session.userForm.location = userLocationName;
        await ctx.scene.enter('about');
      } catch (error) {
        console.error('Location detection error: ', error);
      }
    });
    location.on('text', async (ctx) => {
      if (
        ctx.session.userForm.location &&
        ctx.session.userForm.actualLocation &&
        ctx.session.userForm.location === ctx.message.text
      ) {
        await ctx.scene.enter('about');
      } else {
        const rawData = fs.readFileSync('./UA.json', 'utf8');
        const dataArray = JSON.parse(rawData);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cityNamesArray: any[] = [];

        dataArray.forEach(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (entry: { type: string; public_name: string; name: any }) => {
            const type = entry.type.toLowerCase();
            const isState = type === 'state';
            const nameToUse = isState ? entry.public_name : entry.name;

            if (['city', 'urban', 'settlement', 'state'].includes(type)) {
              let variations = [
                nameToUse.en.toLowerCase(),
                nameToUse.ru.toLowerCase(),
                nameToUse.uk.toLowerCase(),
              ];
              let original = nameToUse.uk;
              if (isState) {
                original = nameToUse.uk.replace(/ обл\.$/, ' область');
                variations = variations.map((variation) =>
                  variation.replace(/ обл\.$/, ' область')
                );
              }
              cityNamesArray.push({ variations, original, type });
            }
          }
        );
        let userInput = ctx.message.text;
        const isInputEnglish = /[a-zA-Z]/.test(userInput);
        if (isInputEnglish) {
          userInput = userInput
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        } else {
          userInput = userInput.trim().toLowerCase();
        }

        const options = {
          includeScore: true,
          keys: ['variations'],
          threshold: 0.2,
        };
        const priorityOrder = ['city', 'urban', 'state', 'settlement'];
        const matchingCities = [];
        for (const type of priorityOrder) {
          const citiesOfType = cityNamesArray.filter(
            (item) => item.type === type
          );
          const fuse = new Fuse(citiesOfType, options);
          const bestMatches = fuse.search(userInput);
          const matchingOfType = bestMatches.filter((match) =>
            priorityOrder.includes(match.item.type)
          );
          if (matchingOfType.length > 0) {
            matchingCities.push(matchingOfType[0]);
          }
        }
        ctx.session.userForm.coordinates = undefined;
        if (matchingCities.length > 0) {
          ctx.session.userForm.actualLocation =
            matchingCities[0].item.original.toLowerCase();
          ctx.session.userForm.location = ctx.message.text;
          await ctx.scene.enter('about');
        } else {
          ctx.session.userForm.location = ctx.message.text;
          ctx.session.userForm.actualLocation = ctx.message.text.toLowerCase();
          await ctx.scene.enter('about');
        }
      }
    });
    location.on('message', async (ctx) => {
      await ctx.reply('Напиши назву свого міста або відправ місцезнаходження');
    });

    return location;
    // function mapLatinToCyrillic(character: string, nextCharacter?: string): string {
    //   const lowercaseCharacter = character.toLowerCase()
    //   const latinToCyrillicMap: { [key: string]: string } = {
    //     a: 'а',
    //     b: 'б',
    //     c: 'ц',
    //     d: 'д',
    //     e: 'е',
    //     f: 'ф',
    //     g: 'г',
    //     h: 'х',
    //     i: 'и',
    //     j: 'й',
    //     k: 'к',
    //     l: 'л',
    //     m: 'м',
    //     n: 'н',
    //     o: 'о',
    //     p: 'п',
    //     q: 'к',
    //     r: 'р',
    //     s: 'с',
    //     t: 'т',
    //     u: 'у',
    //     v: 'в',
    //     w: 'в',
    //     x: 'кс',
    //     y: 'и',
    //     z: 'з',
    //     ь: nextCharacter && /[аеиоуяю]/.test(nextCharacter) ? '' : 'ь',
    //   };
    //   return latinToCyrillicMap[lowercaseCharacter] || character;
    // }
  }

  private maxPhotoCount: number = 3;
  private maxVideoDuration: number = 15;
  private isUploaded = false;
  private uploadNumber = 0;
  private mediaIds: { type: string; id: string }[] = [];
  photoScene(): Scenes.BaseScene<MySceneContext> {
    const photo = new Scenes.BaseScene<MySceneContext>('photo');
    let type: string;
    const isMediaLimitReached = (ctx: MySceneContext) =>
      ctx.session.userForm.mediaIds.length >= this.maxPhotoCount;
    const handleMediaUpload = async (
      ctx: MySceneContext,
      mediaType: string,
      mediaId: string
    ) => {
      if (!isMediaLimitReached(ctx)) {
        this.mediaIds.push({ type: mediaType, id: mediaId });
        this.uploadNumber++;
      }
      if (mediaType === 'video') {
        type = 'Відео';
      } else {
        type = 'Фото';
      }
      if (!isMediaLimitReached(ctx)) {
        await ctx.reply(
          `✅ ${type} №${this.uploadNumber} збережено`,
          Markup.keyboard([['Це все, зберегти медіа']])
            .oneTime()
            .resize()
        );
      } else if (!this.isUploaded) {
        await ctx.reply(
          `✅ ${type} №${this.uploadNumber} збережено`,
          Markup.keyboard([['Це все, зберегти медіа']])
            .oneTime()
            .resize()
        );
        this.isUploaded = true;
        ctx.session.userForm.mediaIds = this.mediaIds;
        await this.saveUserFormToDatabase(ctx.session.userForm);
        await ctx.scene.enter('userform');
      }
    };
    photo.enter(async (ctx) => {
      this.maxPhotoCount = ctx.session.userForm.isPremium ? 7 : 3;
      this.maxVideoDuration = ctx.session.userForm.isPremium ? 60 : 15;
      this.mediaIds = [];
      this.uploadNumber = 0;
      this.isUploaded = false;
      const photoPrompt = `Обери свої найкращі фото (максимум ${this.maxPhotoCount}) або відео (тривалістю до ${this.maxVideoDuration} секунд), які будуть бачити інші`;
      if (ctx.session.userForm.mediaIds.length > 0) {
        await ctx.reply(
          photoPrompt,
          Markup.keyboard([['Залишити як є']])
            .oneTime()
            .resize()
        );
      } else {
        await ctx.reply(photoPrompt, Markup.removeKeyboard());
      }
    });

    this.addCommands(photo);
    photo.hears('Залишити як є', async (ctx) => {
      if (ctx.session.userForm.mediaIds.length > 0) {
        this.isUploaded = true;
        await this.saveUserFormToDatabase(ctx.session.userForm);
        await ctx.scene.enter('userform');
      }
    });
    photo.on('photo', async (ctx) => {
      const photos = ctx.message.photo;
      photos.sort((a, b) => {
        const resolutionA = a.width * a.height;
        const resolutionB = b.width * b.height;
        return resolutionB - resolutionA;
      });
      await handleMediaUpload(ctx, 'photo', photos[0].file_id);
    });

    photo.on('video', async (ctx) => {
      const video = ctx.message.video;
      if (video.duration <= this.maxVideoDuration) {
        await handleMediaUpload(ctx, 'video', video.file_id);
      } else {
        await ctx.reply(
          `Відео занадто довге. Будь-ласка, завантаж відео тривалістю до ${this.maxVideoDuration} секунд`
        );
      }
    });
    photo.hears('Це все, зберегти медіа', async (ctx) => {
      this.isUploaded = true;
      ctx.session.userForm.mediaIds = this.mediaIds;
      await this.saveUserFormToDatabase(ctx.session.userForm);
      await ctx.scene.enter('userform');
    });
    photo.hears('👫 Звичайний пошук', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    photo.hears('🍾 Події', async (ctx) => {
      await ctx.scene.enter('eventChoose');
    });
    photo.on('message', async (ctx) => {
      await ctx.reply(
        'Завантаж, будь-ласка, своє фото або відео',
        Markup.removeKeyboard()
      );
    });
    return photo;
  }

  userFormScene(): Scenes.BaseScene<MySceneContext> {
    const userFormScene = new Scenes.BaseScene<MySceneContext>('userform');
    userFormScene.enter(async (ctx) => {
      const userId = ctx.from?.id;
      if (userId) {
        const userForm = await this.getUserFormDataFromDatabase(userId);
        if (userForm) {
          if (!ctx.session.userForm) {
            ctx.session.userForm = new UserFormModel({});
          }
          Object.assign(ctx.session.userForm, userForm);
          await this.registerUserLastActivity(userForm.userId);
          let caption =
            `Так виглядає твій профіль:\n\n` +
            (userForm.isPremium && userForm.showPremiumLabel
              ? `⭐️ *Premium Crush*\n\n`
              : '') +
            `*Ім'я:* ${userForm.username}\n*Вік:* ${userForm.age}\n*Місто:* ${userForm.location}`;

          if (userForm.about?.type === 'text') {
            caption = caption + `\n\n*Про себе:* ${userForm.about.content}`;
          }
          caption =
            caption +
            (userForm.isPremium && userForm.showLikesCount
              ? `\n\n*❤️ — ${userForm.likesCount ?? 0}*`
              : '');
          if (userForm.socialLinks && userForm.socialLinks.length > 0) {
            let message = '';
            for (const link of userForm.socialLinks) {
              message = message ? message + ' | ' : message + '';
              message = message + link;
            }
            caption = caption + '\n\n' + message;
          }
          const mediaGroup: MediaGroup = userForm.mediaIds.map(
            (mediaObj: { type: string; id: string }, index: number) => ({
              type: mediaObj.type as 'document',
              media: mediaObj.id,
              caption: index === 0 ? caption : undefined,
              parse_mode: index === 0 ? 'Markdown' : undefined,
            })
          );
          await ctx.replyWithMediaGroup(mediaGroup);
          if (ctx.session.userForm.about?.type === 'voice') {
            await ctx.replyWithVoice(ctx.session.userForm.about.content, {
              caption: '*Про себе:*',
              parse_mode: 'Markdown',
            });
          }
          await ctx.reply(
            `✍🏻 — Редагувати профіль
🆕 — Додати подію
🎟 — Мої події
🗄 — Архів лайків
⭐️ — Преміум налаштування
❌ — Приховати профіль`,
            Markup.keyboard([['✍🏻', '🆕', '🎟', '🗄', '⭐️', '❌']])
              .oneTime()
              .resize()
          );
        } else {
          await ctx.scene.enter('gender');
        }
      }
    });
    userFormScene.hears('✍🏻', async (ctx) => {
      await ctx.scene.enter('userformEdit');
    });
    userFormScene.hears('🆕', async (ctx) => {
      await ctx.scene.enter('eventName');
    });
    userFormScene.hears('🎟', async (ctx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let events: any;
      let currentEventIndex = 0;
      const userForm = await this.getUserFormDataFromDatabase(ctx.from!.id);
      if (userForm) {
        events = await this.getUserEventsFromDatabase(userForm.userId);
        ctx.session.userForm.userId = ctx.from!.id;
        if (events && events.length > 0) {
          await ctx.reply(`Ось твої події 👇🏻 `, Markup.removeKeyboard());
          // eslint-disable-next-line no-empty-pattern
          for (let {} of events) {
            await this.showUserEvent(events, currentEventIndex, ctx);
            currentEventIndex++;
          }
        } else {
          await ctx.reply(
            'Більше подій немає, можеш створити нову',
            Markup.removeKeyboard()
          );
        }
      } else {
        await ctx.reply(
          'Щоб переглянути події створи свій профіль',
          Markup.removeKeyboard()
        );
        await ctx.scene.enter('gender');
      }
      const regex = new RegExp(/^deleteEvent:(.*)$/);
      userFormScene.action(regex, async (ctx) => {
        const userId = +ctx.match[1];

        await this.db.collection('events').deleteOne({ userId: userId });
        await ctx.deleteMessage();
      });
    });
    userFormScene.hears('🗄', async (ctx) => {
      await ctx.scene.enter('likeArchive');
    });
    userFormScene.hears('⭐️', async (ctx) => {
      if (ctx.session.userForm.isPremium) {
        await ctx.scene.enter('premiumSettings');
      } else {
        await ctx.reply(
          'В тебе поки немає преміуму, але ти завжди можеш його придбати',
          Markup.keyboard([['⭐️ Купити преміум']])
            .oneTime()
            .resize()
        );
      }
    });
    userFormScene.hears('❌', async (ctx) => {
      await ctx.reply(
        `Після підтвердження, ваша анкета не буде відображатися іншим користувачам.
      
Анкета автоматично активується, якщо ви знову розпочнете пошук 👥
      
Ви дійсно хочете прибрати свою анкету з пошуку?`,
        Markup.keyboard([
          ['✅ Так, прибрати з пошуку', '❌ Ні, повернутись назад'],
        ]).resize()
      );
    });
    userFormScene.hears('✅ Так, прибрати з пошуку', async (ctx) => {
      await this.db
        .collection('users')
        .updateOne({ userId: ctx.from.id }, { $set: { isActive: false } });
      await ctx.reply(
        'Дякуємо за користування нашим ботом. Сподіваємось, що ви чудово провели чаc 🖤',
        Markup.removeKeyboard()
      );
    });
    userFormScene.hears('❌ Ні, повернутись назад', async (ctx) => {
      await ctx.reply(
        `✍🏻 — Редагувати профіль
🆕 — Додати подію
🎟 — Мої події
🗄 — Архів лайків
⭐️ — Преміум налаштування
❌ — Приховати профіль`,
        Markup.keyboard([['✍🏻', '🆕', '🎟', '🗄', '⭐️', '❌']])
          .oneTime()
          .resize()
      );
    });
    userFormScene.hears('⭐️ Купити преміум', async (ctx) => {
      await ctx.scene.enter('premiumBenefits');
    });
    this.addCommands(userFormScene);
    userFormScene.on('message', async (ctx) => {
      await ctx.reply(
        `✍🏻 — Редагувати профіль
🆕 — Додати подію
🎟 — Мої події
🗄 — Архів лайків
⭐️ — Преміум налаштування
❌ — Приховати профіль`,
        Markup.keyboard([['✍🏻', '🆕', '🎟', '🗄', '⭐️', '❌']])
          .oneTime()
          .resize()
      );
    });
    return userFormScene;
  }
  userFormEditScene(): Scenes.BaseScene<MySceneContext> {
    const userFormEditScene = new Scenes.BaseScene<MySceneContext>(
      'userformEdit'
    );
    userFormEditScene.enter(async (ctx) => {
      await ctx.reply(
        `1. Заповнити анкету заново
2. Змінити фото або відео`,
        Markup.keyboard([['1', '2']])
          .resize()
          .oneTime()
      );
      userFormEditScene.hears('1', async (ctx) => {
        await ctx.scene.enter('gender');
      });
      userFormEditScene.hears('2', async (ctx) => {
        await ctx.scene.enter('photo');
      });
      userFormEditScene.on('message', async (ctx) => {
        await ctx.reply('👇🏻', Markup.keyboard([['1', '2']]).resize());
      });
    });
    this.addCommands(userFormEditScene);
    return userFormEditScene;
  }
  eventMenuScene(): Scenes.BaseScene<MySceneContext> {
    const eventMenu = new Scenes.BaseScene<MySceneContext>('eventMenu');
    eventMenu.enter(async (ctx) => {
      ctx.reply(
        `Чудово ) Тепер ти можеш ознайомитися з 
переліком подій або додати свою`,
        Markup.inlineKeyboard([
          Markup.button.callback('Додати подію', 'addEvent'),
          Markup.button.callback('Переглянути спосок подій', 'viewEvent'),
        ])
      );
    });
    this.addCommands(eventMenu);
    eventMenu.action('addEvent', async (ctx) => {
      await ctx.scene.enter('eventName');
    });
    eventMenu.action('viewEvent', async (ctx) => {
      await ctx.scene.enter('eventList');
    });
    eventMenu.on('message', async (ctx) => {
      await ctx.reply('Додай подію або обери зі списку');
    });
    return eventMenu;
  }
  eventNameScene(): Scenes.BaseScene<MySceneContext> {
    const eventName = new Scenes.BaseScene<MySceneContext>('eventName');
    eventName.enter(async (ctx) => {
      this.event = {
        userId: NaN,
        eventId: Math.floor(Math.random() * 1000),
        eventName: '',
        date: '',
        about: undefined,
        lookingFor: '',
        location: ''
      };
      ctx.reply('Напиши назву події', Markup.removeKeyboard());
    });
    this.addCommands(eventName);
    eventName.on('text', async (ctx) => {
      this.event.eventName = ctx.message.text;
      this.event.userId = ctx.message.from.id;
      await ctx.scene.enter('eventTime');
    });
    eventName.on('message', async (ctx) => {
      await ctx.reply('Вкажи назву події');
    });
    return eventName;
  }
  eventTimeScene(): Scenes.BaseScene<MySceneContext> {
    const eventTime = new Scenes.BaseScene<MySceneContext>('eventTime');
    eventTime.enter(async (ctx) => {
      ctx.reply('Вкажи дату події');
    });
    this.addCommands(eventTime);
    eventTime.on('text', async (ctx) => {
      this.event.date = ctx.message.text;
      await ctx.scene.enter('eventAbout');
    });
    eventTime.on('message', async (ctx) => {
      await ctx.reply('Вкажи дату події');
    });

    return eventTime;
  }
  eventAboutScene(): Scenes.BaseScene<MySceneContext> {
    const eventAbout = new Scenes.BaseScene<MySceneContext>('eventAbout');
    eventAbout.enter(async (ctx) => {
      ctx.reply(
        'Уточни деталі пропозиції/події',
        Markup.keyboard(['Пропустити']).resize()
      );
    });
    this.addCommands(eventAbout);
    eventAbout.hears('Пропустити', async (ctx) => {
      this.event.about = undefined;
      await ctx.scene.enter('eventLookingFor');
    });
    eventAbout.on('text', async (ctx) => {
      this.event.about = ctx.message.text;
      await ctx.scene.enter('eventLookingFor');
    });
    eventAbout.on('message', async (ctx) => {
      await ctx.reply('Вкажи деталі події');
    });

    return eventAbout;
  }
  eventLookigForScene(): Scenes.BaseScene<MySceneContext> {
    const eventLookingFor = new Scenes.BaseScene<MySceneContext>(
      'eventLookingFor'
    );
    eventLookingFor.enter(async (ctx) => {
      await ctx.reply(
        'Чудово! Кого бажаєш запросити',
        Markup.keyboard([['Дівчину', 'Хлопця', 'Будь-кого']]).resize()
      );
    });
    this.addCommands(eventLookingFor);
    eventLookingFor.on('text', async (ctx) => {
      switch (ctx.message.text) {
        case 'Дівчину':
          this.event.lookingFor = 'female';
          break;
        case 'Хлопця':
          this.event.lookingFor = 'male';
          break;
        case 'Будь-кого':
          this.event.lookingFor = 'both';
          break;
        default:
          await ctx.reply(
            'Обери кого бажаєш запросити',
            Markup.keyboard([['Дівчину', 'Хлопця', 'Будь-кого']]).resize()
          );
      }
      if (this.event.lookingFor) {
        await ctx.scene.enter('eventLocation');
      }
    });
    eventLookingFor.on('message', async (ctx) => {
      await ctx.reply(
        'Обери кого бажаєш запросити',
        Markup.keyboard([['Дівчину', 'Хлопця', 'Будь-кого']]).resize()
      );
    });
    return eventLookingFor;
  }

  eventLocationScene(): Scenes.BaseScene<MySceneContext> {
    const eventLocation = new Scenes.BaseScene<MySceneContext>('eventLocation');
    eventLocation.enter(async (ctx) => {
      if (ctx.session.userForm.location) {
        await ctx.reply(
          'Вкажи місто у якому буде проводитись подія',
          Markup.keyboard([[ctx.session.userForm.location]])
            .oneTime()
            .resize()
        );
      } else {
        await ctx.reply(
          'Вкажи місто у якому буде проводитись подія',
          Markup.removeKeyboard()
        );
      }
    });
    this.addCommands(eventLocation);
    eventLocation.on('text', async (ctx) => {
      if (ctx.message.text.length > 30) {
        await ctx.reply('Занадто довга назва міста');
      } else {
        this.event.location = ctx.message.text;
        await this.saveEventToDatabase(this.event);
        await ctx.reply(
          `Бінго! Очікуй на свій perfect match та неймовірно проведений час `,
          Markup.removeKeyboard()
        );
      }
    });
    eventLocation.on('message', async (ctx) => {
      if (ctx.session.userForm.location) {
        await ctx.reply(
          'Вкажи місто у якому буде проводитись подія',
          Markup.keyboard([[ctx.session.userForm.location]])
            .oneTime()
            .resize()
        );
      } else {
        await ctx.reply(
          'Вкажи місто у якому буде проводитись подія',
          Markup.removeKeyboard()
        );
      }
    });
    return eventLocation;
  }
  // eventAgeRangeScene(): Scenes.BaseScene<MySceneContext> {
  //   const eventAgeRange = new Scenes.BaseScene<MySceneContext>('eventAgeRange');
  //   eventAgeRange.enter(async (ctx) => {
  //     ctx.reply(
  //       'Який віковий діапазон?',
  //       Markup.keyboard([['18-20', '20-22', '22-25', 'Будь-який']]).resize()
  //     );
  //   });
  //   this.addCommands(eventAgeRange);
  //   const handleAgeRange = async (ctx: MySceneContext, ageRange: string) => {
  //     this.event.ageRange = ageRange;
  //     await ctx.reply(
  //       `Бінго! Очікуй на свій perfect match та неймовірно проведений час )`,
  //       Markup.removeKeyboard()
  //     );
  //     await this.saveEventToDatabase(this.event);
  //   };

  //   eventAgeRange.hears('18-20', async (ctx) => {
  //     await handleAgeRange(ctx, '18-20');
  //   });

  //   eventAgeRange.hears('20-22', async (ctx) => {
  //     await handleAgeRange(ctx, '20-22');
  //   });

  //   eventAgeRange.hears('22-25', async (ctx) => {
  //     await handleAgeRange(ctx, '22-25');
  //   });

  //   eventAgeRange.hears('Будь-який', async (ctx) => {
  //     await handleAgeRange(ctx, 'Будь-який');
  //   });
  //   eventAgeRange.on('message', async (ctx) => {
  //     await ctx.reply('Обери віковий діапазон');
  //   });

  //   return eventAgeRange;
  // }
  eventChooseScene(): Scenes.BaseScene<MySceneContext> {
    const eventChoose = new Scenes.BaseScene<MySceneContext>('eventChoose');
    eventChoose.enter(async (ctx) => {
      await ctx.reply(
        `Обери тип подій, які хочеш переглянути\n\n🍾 — Події, створені користувачами\n🎫 — Події, запропоновані ботом`,
        Markup.keyboard([['🍾', '🎫']])
          .oneTime()
          .resize()
      );
    });
    eventChoose.hears('🍾', async (ctx) => {
      await ctx.scene.enter('eventList');
    });
    eventChoose.hears('🎫', async (ctx) => {
      await ctx.scene.enter('botEventList');
    });
    this.addCommands(eventChoose);
    eventChoose.on('message', async (ctx) => {
      await ctx.reply(
        `Обери тип подій, які хочеш переглянути\n\n🍾 — Події, створені користувачами\n🎫 — Події, запропоновані ботом`,
        Markup.keyboard([['🍾', '🎫']])
          .oneTime()
          .resize()
      );
    });
    return eventChoose;
  }

  botEventListScene(): Scenes.BaseScene<MySceneContext> {
    const botEventList = new Scenes.BaseScene<MySceneContext>('botEventList');
    let currentEventIndex = 0;
    let currentEventId = 0;
    let events: Event[];
    botEventList.enter(async (ctx) => {
      const user = await this.getUserFormDataFromDatabase(ctx.from!.id);
      if (user) {
        if (!ctx.session.userForm) {
          ctx.session.userForm = new UserFormModel({});
        }
        Object.assign(ctx.session.userForm, user);
        events = (await this.getBotEventsListFromDatabase(
          user.actualLocation
        )) as unknown as Event[];
        currentEventIndex = 0;
        currentEventId = 0;
        if (events && events.length > 0) {
          await ctx.reply(
            'Ось список подій у твоєму місті 👇🏻',
            Markup.keyboard([['❤️', '👎']]).resize()
          );
          await this.showBotEvent(events, currentEventIndex, ctx);
        } else {
          await ctx.reply(
            `Схоже в твоєму місті подій немає, зв'яжись з підримкою, якщо хочеш побачити підбірку подій у своєму місті`,
            Markup.removeKeyboard()
          );
        }
        await this.registerUserLastActivity(user.userId);
      } else {
        await ctx.reply(
          'Щоб користуватись промокодами спочатку треба створити акаунт',
          Markup.keyboard([['👤 Створити профіль']])
            .oneTime()
            .resize()
        );
      }
    });
    botEventList.hears('❤️', async (ctx) => {
      if (!ctx.session.eventDetails?.lookingFor) {
        ctx.session.eventDetails = {
          lookingFor: '',
          eventId: 0,
        };
      }
      currentEventId = events[currentEventIndex].eventId;
      ctx.session.eventDetails.eventId = currentEventId;
      currentEventIndex++;
      await ctx.scene.enter('botEventLookingFor');
    });
    botEventList.hears('👎', async (ctx) => {
      currentEventIndex++;
      await this.showBotEvent(events, currentEventIndex, ctx);
    });
    botEventList.hears('👤 Створити профіль', async (ctx) => {
      await ctx.scene.enter('userform');
    });
    this.addCommands(botEventList);
    botEventList.on('message', async (ctx) => {
      await ctx.reply('Обери подію на яку хочеш піти з кимось');
    });
    return botEventList;
  }

  private isLookingForEventMatch = false;
  botEventLookingForScene(): Scenes.BaseScene<MySceneContext> {
    const botEventLookingFor = new Scenes.BaseScene<MySceneContext>(
      'botEventLookingFor'
    );
    botEventLookingFor.enter(async (ctx) => {
      await ctx.reply(
        'Чудово! Кого бажаєш запросити',
        Markup.keyboard([['Дівчину', 'Хлопця', 'Будь-кого']]).resize()
      );
    });
    this.addCommands(botEventLookingFor);
    botEventLookingFor.on('text', async (ctx) => {
      switch (ctx.message.text) {
        case 'Дівчину':
          ctx.session.eventDetails.lookingFor = 'female';
          break;
        case 'Хлопця':
          ctx.session.eventDetails.lookingFor = 'male';
          break;
        case 'Будь-кого':
          ctx.session.eventDetails.lookingFor = 'both';
          break;
        default:
          await ctx.reply(
            'Обери кого бажаєш запросити',
            Markup.keyboard([['Дівчину', 'Хлопця', 'Будь-кого']]).resize()
          );
      }
      if (ctx.session.eventDetails.lookingFor) {
        this.isLookingForEventMatch = true;
        await ctx.scene.enter('lookForMatch');
      }
    });
    botEventLookingFor.on('message', async (ctx) => {
      await ctx.reply(
        'Обери кого бажаєш запросити',
        Markup.keyboard([['Дівчину', 'Хлопця', 'Будь-кого']]).resize()
      );
    });
    return botEventLookingFor;
  }

  eventListScene(): Scenes.BaseScene<MySceneContext> {
    const eventList = new Scenes.BaseScene<MySceneContext>('eventList');
    let currentEventIndex = 0;
    let eventUserId = 0;
    let eventId = 0;
    //let currentUserIndex = 0;
    let events: Event[];
    eventList.enter(async (ctx) => {
      const userForm = await this.getUserFormDataFromDatabase(ctx.from!.id);
      if (userForm) {
        if (!ctx.session.userForm?.userId) {
          ctx.session.userForm = new UserFormModel({});
        }
        Object.assign(ctx.session.userForm, userForm);
        eventUserId = 0;
        eventId = 0;
        events = (await this.getEventsFromDatabase(
          userForm.userId,
          userForm.gender,
          userForm.actualLocation
        )) as unknown as Event[];
        await ctx.reply(`🍾 Розпочинаємо пошук подій...

Сподіваємось, ви чудово проведете час.
        
👀 Нагадаємо, що тут ви можете знайти цікаву для себе подію та піти на неї з тим, хто створив цю подію!`);
        currentEventIndex = 0;
        ctx.session.userForm.userId = ctx.from!.id;
        if (events && events.length > 0) {
          await ctx.reply('Список подій 👇🏻', Markup.removeKeyboard());
          await this.showEvent(events, currentEventIndex, ctx);
        } else {
          await ctx.reply(
            'Більше подій немає, можеш створити нову',
            Markup.removeKeyboard()
          );
        }
        await this.registerUserLastActivity(userForm.userId);
      } else {
        await ctx.reply(
          'Щоб переглянути події створи свій профіль',
          Markup.removeKeyboard()
        );
        await ctx.scene.enter('gender');
      }
    });

    eventList.action('nextEvent', async (ctx) => {
      currentEventIndex++;
      await this.showEvent(events, currentEventIndex, ctx);
      await ctx.editMessageReplyMarkup(undefined);
    });
    const regex = new RegExp(/^inviteToEvent:(.*):(.*)$/);
    eventList.action(regex, async (ctx) => {
      eventUserId = +ctx.match[1];
      eventId = +ctx.match[2];
      const eventUser = await this.getUserFormDataFromDatabase(eventUserId) as unknown as UserForm;
      if (eventUser) {
        const event = await this.getEventFromDatabase(eventUserId, eventId);
        if (event) {
          await ctx.editMessageReplyMarkup(undefined);
        const mediaGroup =  this.showUserProfile(eventUser, ctx.session.userForm)
          await ctx.reply(
            'Ініціатор запрошення на подію 👇🏻',
            Markup.keyboard([['❤️', '👎']]).resize()
          );
          await ctx.replyWithMediaGroup(mediaGroup);
          if (eventUser.about && eventUser.about.type === 'voice') {
            await ctx.replyWithVoice(eventUser.about.content, {
              caption: '*Про себе:*',
              parse_mode: 'Markdown',
            });
          }
        } else {
          await ctx.reply('Схоже такої події не знайдено');
        }
      } else {
        await ctx.reply('Схоже користувач приховав свій профіль');
      }

      // Intive to event code
      // currentUserIndex = 0;
      // const userId = ctx.from!.id;
      // const eventName = ctx.match[1];
      // const eventDate = ctx.match[2];
      // try {
      //   const userFormData = await this.getUserFormDataFromDatabase(userId);
      //   if (userFormData) {
      //     Object.assign(ctx.session.userForm, userFormData);
      //   }
      //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
      //   const query: any = {
      //     userId: { $ne: userId },
      //     actualLocation: ctx.session.userForm.actualLocation,
      //     gender:
      //       ctx.session.userForm.lookingFor === 'both'
      //         ? { $in: ['male', 'female'] }
      //         : ctx.session.userForm.lookingFor,
      //     lookingFor: { $in: [ctx.session.userForm.gender, 'both'] },
      //   };
      //
      //
      //   const userMatchForms = await db
      //     .collection('users')
      //     .find(query)
      //     .toArray();
      //   await this.sendUserDetails(
      //     userMatchForms as unknown as UserForm[],
      //     currentUserIndex,
      //     ctx
      //   );
      //   eventList.hears('❤️', async () => {
      //     currentUserIndex++;
      //     this.sendUserDetails(
      //       userMatchForms as unknown as UserForm[],
      //       currentUserIndex,
      //       ctx
      //     );
      //     if (currentUserIndex > 0) {
      //       const previousUser = userMatchForms[currentUserIndex - 1];
      //       const previousUserId = previousUser.userId;
      //       try {
      //         let username = ctx.from?.username;
      //         if (username) {
      //           username = '@' + username;
      //         }
      //         const userId = ctx.from!.id;
      //         const userLink = `tg://user?id=${userId}`;
      //         const mentionMessage =
      //           username || `[${ctx.from?.first_name}](${userLink})`;
      //         const userForm = await this.getUserFormDataFromDatabase(userId);
      //       if (userForm) {
      //         await ctx.telegram.sendPhoto(previousUserId, userForm.photoId, {
      //           caption: `${ctx.session.userForm.username}, ${ctx.session.userForm.age}, ${ctx.session.userForm.location}, хоче піти з тобою на подію ${eventName} ${eventDate}. Обговори деталі та приємно проведіть цей час 👋`,
      //           parse_mode: 'Markdown',
      //           reply_markup: {
      //             inline_keyboard: [
      //               [
      //                 {
      //                   text: '❤️',
      //                   callback_data: `likeEvent:${userId}:${mentionMessage}`,
      //                 },
      //                 {
      //                   text: '👎',
      //                   callback_data: `dislikeEvent:${userId}:${ctx.from?.username}`,
      //                 },
      //               ],
      //             ],
      //           },
      //         });
      //         await ctx.reply(
      //           `Супер! Очікуй на повідомлення від ініціатора події 🥳 Бажаю приємно провести час 👋`,
      //           Markup.removeKeyboard()
      //         );
      //       }
      //     } catch (error) {
      //       console.error('Error sending notification:', error);
      //     }
      //   }
      // });
      // eventList.hears('👎', () => {
      //   currentUserIndex++;
      //   this.sendUserDetails(
      //     userMatchForms as unknown as UserForm[],
      //     currentUserIndex,
      //     ctx
      //   );
      // });
      // } catch (error) {
      //   console.error('Error getting userForm data from db', error);
      // }
    });
    eventList.hears('❤️', async (ctx) => {
      const userForm = await this.getUserFormDataFromDatabase(ctx.from.id);
      if (userForm) {
        let username = ctx.from?.username;
        if (username) {
          username = '@' + username;
        }
        const userId = ctx.from!.id;
        const userLink = `tg://user?id=${userId}`;
        const mentionMessage =
          username || `[${ctx.from?.first_name}](${userLink})`;
        // const userAbout = userForm.about ? `, ${userForm.about}` : '';
        // const eventAbout = event.about ? `, ${event.about}` : '';
        const insertData: {
          senderId: number;
          receiverId: number;
          senderMentionMessage: string;
          eventId?: number;
          isUserEvent: boolean;
        } = {
          senderId: userId,
          receiverId: eventUserId,
          senderMentionMessage: mentionMessage,
          eventId: eventId,
          isUserEvent: true,
        };
        if (eventUserId === 0) {
          return;
        }
        await this.db.collection('matches').insertOne(insertData);
        //               await ctx.telegram.sendPhoto(eventUserId, userForm.photoId, {
        //                 caption: `👀Один краш бажає піти з тобою на запропоновану тобою подію:

        // 🧘🏼*Краш:* ${userForm.username}, ${userForm.age}, ${userForm.location}${userAbout}

        // 🎟 *Подія:* ${event.eventName}, ${event.date}${eventAbout}`,
        //                 parse_mode: 'Markdown',
        //                 reply_markup: {
        //                   inline_keyboard: [
        //                     [
        //                       {
        //                         text: '❤️',
        //                         callback_data: `likeEvent:${userId}:${mentionMessage}`,
        //                       },
        //                       {
        //                         text: '👎',
        //                         callback_data: `dislikeEvent`,
        //                       },
        //                     ],
        //                   ],
        //                 },
        //               });
        try {
          const message = `👀Один краш відгукнувся на твою подію, щоб переглянути хто це перейди у *архів лайків* 🗄`;
          await ctx.telegram.sendMessage(eventUserId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [['🗄 Перейти у архів']],
              resize_keyboard: true,
            },
          });
        } catch (error) {
          console.error('Event like error: ', error)
        }
        await ctx.reply(
          `Супер! Очікуй на повідомлення від ініціатора події 🥳 Бажаю приємно провести час 👋`,
          Markup.removeKeyboard()
        );
        await this.db
          .collection('users')
          .updateOne({ userId: eventUserId }, { $inc: { likesCount: 1 } });
        eventUserId = 0;
      } else {
        await ctx.reply('Спочатку створи анкету');
        await ctx.scene.enter('gender');
      }
    });
    eventList.hears('👎', async (ctx) => {
      if (eventUserId === 0) {
        return;
      }
      await ctx.reply('Продовжуємо шукати...');
      currentEventIndex++;
      await this.showEvent(events, currentEventIndex, ctx);
      eventUserId = 0;
    });
    this.addCommands(eventList);
    eventList.on('message', async (ctx) => {
      await ctx.reply('Обери подію на яку бажаєш піти');
    });
    return eventList;
  }
  private reportedUserId: number | undefined = undefined;
  private isProfilesEnded = false;
  private isProfilesWithLocationEnded = false;
  private isLikeMessage = false;
  private insertData: Match | undefined;
  lookForMatchScene(): Scenes.BaseScene<MySceneContext> {
    const lookForMatch = new Scenes.BaseScene<MySceneContext>('lookForMatch');
    let currentUserIndex = 0;
    let job: cron.ScheduledTask;
    let userMatchForms: UserForm[];
    lookForMatch.enter(async (ctx) => {
      this.isProfilesEnded = false;
      this.isLikeMessage = false;
      this.insertData = undefined;
      this.isProfilesWithLocationEnded = false;
      const userFormData = await this.getUserFormDataFromDatabase(ctx.from!.id);
      if (userFormData && userFormData.banExpirationDate) {
        await ctx.reply('Ти в бані');
        return;
      }
      currentUserIndex = 0;
      if (userFormData) {
        if (!ctx.session.userForm) {
          ctx.session.userForm = new UserFormModel({});
        }
        Object.assign(ctx.session.userForm, userFormData);
        await this.registerUserLastActivity(userFormData.userId);
        await ctx.reply(
          `👫 Розпочинаємо звичайний пошук...

Сподіваємось, ти знайдеш свого краша
            
👀 Пам ятайте, що люди в Інтернеті можуть бути не тими, за кого себе видають`,
          Markup.keyboard([['❤️', '❤️‍🔥', '👎', 'Скарга']]).resize()
        );
        if (!ctx.session.userForm.isActive) {
          ctx.session.userForm.isActive = true;
          await this.db
            .collection('users')
            .updateOne({ userId: ctx.from!.id }, { $set: { isActive: true } });
          await ctx.reply('З поверненням тебе 🤗\nТвоя анкета знову у пошуку');
        }
        const viewQuery = [
          {
            $match: {
              viewerUserId: ctx.session.userForm.userId,
            },
          },
          {
            $group: {
              _id: null,
              viewedUserIds: { $addToSet: '$viewedUserId' },
            },
          },
        ];

        const aggregationResult = await this.db
          .collection('viewed_profiles')
          .aggregate(viewQuery)
          .toArray();
        let distinctViewedUserIds = [];
        if (aggregationResult.length > 0) {
          distinctViewedUserIds = aggregationResult[0].viewedUserIds;
        }
        const pipeline = [
          {
            $match: {
              $and: [
                {
                  userId: { $ne: ctx.session.userForm.userId },
                  actualLocation: ctx.session.userForm.actualLocation,
                  gender:
                    ctx.session.userForm.lookingFor === 'both'
                      ? { $in: ['male', 'female'] }
                      : ctx.session.userForm.lookingFor,
                  lookingFor: { $in: [ctx.session.userForm.gender, 'both'] },
                  isActive: true,
                },
                {
                  userId: { $nin: distinctViewedUserIds },
                },
              ],
            },
          },
          {
            $addFields: {
              randomWeight: { $rand: {} },
            },
          },
          {
            $addFields: {
              isPremiumWeight: {
                $cond: {
                  if: { $eq: ['$isPremium', true] },
                  then: { $add: ['$randomWeight', 0.5] },
                  else: '$randomWeight',
                },
              },
            },
          },
          {
            $sort: { isPremiumWeight: -1 },
          },
        ];

        userMatchForms = (await this.db
          .collection('users')
          .aggregate(pipeline)
          .toArray()) as unknown as UserForm[];
        if (userMatchForms.length > 0) {
          await this.sendUserDetails(
            userMatchForms as unknown as UserForm[],
            currentUserIndex,
            ctx
          );
        } else if (userMatchForms.length === 0) {
          userMatchForms = await this.loadProfilesWithoutLocationSpecified(ctx);
          if (userMatchForms.length > 0) {
            await this.sendUserDetails(
              userMatchForms as unknown as UserForm[],
              currentUserIndex,
              ctx
            );
          } else {
            await ctx.reply(
              'Користувачів за такими параметрами не знайдено\nСпробуй змінити параметри пошуку або зачекай',
              Markup.removeKeyboard()
            );
          }
        }
        job = cron.schedule('*/3 * * * *', async () => {
          try {
            //every 3 minutes
            console.log('scheduler lookForMatch works!');
            const newProfiles = (await this.db
              .collection('users')
              .aggregate(pipeline)
              .toArray()) as unknown as UserForm[];
            const unseenProfiles = userMatchForms.slice(currentUserIndex);
            const updatedNewProfiles = newProfiles.filter((profile) =>
              unseenProfiles.every(
                (unseenProfile) => unseenProfile.userId !== profile.userId
              )
            );
            userMatchForms = userMatchForms.concat(updatedNewProfiles);
            const user = await this.getUserFormDataFromDatabase(ctx.from!.id);
            Object.assign(ctx.session.userForm, user);
          } catch (error) {
            console.error(
              'Error while updating profilesList in lookForMatch scene: ',
              error
            );
          }
        });
      } else {
        await ctx.reply(
          'Щоб переглядати профілі інших користувачів, необхіодно створити свій',
          Markup.removeKeyboard()
        );
        await ctx.scene.enter('gender');
      }
    });
    lookForMatch.hears('❤️', async (ctx) => {
      this.isLikeMessage = false;
      await this.registerUserLastActivity(ctx.session.userForm.userId);
      if (
        !ctx.session.userForm.isPremium &&
        ctx.session.userForm.likesSentCount >= MAX_LIKES_LIMIT
      ) {
        await ctx.reply(
          'Вибач, але ти досяг ліміту лайків на сьогодні, купи преміум підписку або почекай до завтра'
        );
        return;
      }
      if (!ctx.session.userForm.isPremium) {
        ctx.session.userForm.likesSentCount++;
        await this.db
          .collection('users')
          .updateOne(
            { userId: ctx.session.userForm.userId },
            { $set: { likesSentCount: ctx.session.userForm.likesSentCount } }
          );
      }
      currentUserIndex++;
      this.isProfilesWithLocationEnded = await this.sendUserDetails(
        userMatchForms as unknown as UserForm[],
        currentUserIndex,
        ctx
      );
      if (currentUserIndex > 0) {
        const previousUser = userMatchForms[currentUserIndex - 1];
        const previousUserId = previousUser.userId;
        try {
          const viewerUserId = ctx.session.userForm.userId;
          if (previousUserId) {
            await this.db.collection('viewed_profiles').insertOne({
              viewerUserId: viewerUserId,
              viewedUserId: previousUserId,
              expiryTimestamp: new Date(Date.now() + TIME_TO_VIEW_EXPIRE),
            });
            let username = ctx.from?.username;
            if (username) {
              username = '@' + username;
            }
            const userId = ctx.from!.id;
            const userLink = `tg://user?id=${userId}`;
            const mentionMessage =
              username || `[${ctx.from?.first_name}](${userLink})`;
            let message = `👀Один краш поставив вподобайку твоєму профілю, щоб переглянути хто це перейди у *архів лайків* 🗄`;
            await this.db
              .collection('users')
              .updateOne(
                { userId: previousUserId },
                { $inc: { likesCount: 1 } }
              );
            if (this.isLookingForEventMatch) {
              message = `👀Один краш запрошує тебе кудись, щоб переглянути хто це перейди у *архів лайків* 🗄`;
            }
            await ctx.telegram.sendMessage(previousUserId, message, {
              parse_mode: 'Markdown',
              reply_markup: {
                keyboard: [['🗄 Перейти у архів']],
                resize_keyboard: true,
              },
            });
            this.insertData = {
              senderId: userId,
              receiverId: previousUserId,
              senderMentionMessage: mentionMessage,
              likeMessage: null,
            };
            if (ctx.session.eventDetails?.eventId) {
              this.insertData.eventId = ctx.session.eventDetails.eventId;
            }
            const updateQuery: {
              senderId: number;
              receiverId: number;
              eventId?: number;
            } = {
              senderId: this.insertData.senderId,
              receiverId: this.insertData.receiverId,
            };
            if (this.insertData.eventId) {
              updateQuery.eventId = this.insertData.eventId;
            }
            await this.db.collection('matches').updateOne(
              updateQuery,
              {
                $set: this.insertData,
              },
              {
                upsert: true,
              }
            );
          }
        } catch (error) {
          console.error('Error sending notification:', error);
        }
        if (this.isProfilesWithLocationEnded && !this.isProfilesEnded) {
          userMatchForms = await this.loadProfilesWithoutLocationSpecified(ctx);
          currentUserIndex = 0;
          this.isProfilesEnded = await this.sendUserDetails(
            userMatchForms as unknown as UserForm[],
            currentUserIndex,
            ctx
          );
        }
        if (this.isProfilesEnded) {
          await ctx.reply(
            'Більше немає людей, які підходять під твої запити',
            Markup.removeKeyboard()
          );
        }
      }
      // await ctx.telegram.sendPhoto(previousUserId, userForm.photoId, {
      //   caption: message,
      //   parse_mode: 'Markdown',
      //   reply_markup: {
      //     inline_keyboard: [
      //       [
      //         {
      //           text: '❤️',
      //           callback_data: `like:${userId}:${mentionMessage}`,
      //         },
      //         {
      //           text: '👎',
      //           callback_data: `dislike`,
      //         },
      //       ],
      //     ],
      //   },
      // });
      // await ctx.reply(
      //   `Супер! Очікуй на повідомлення від ініціатора події 🥳 Бажаю приємно провести час 👋`
      // , Markup.removeKeyboard());

      // await ctx.telegram.sendMessage(
      //   previousUserId,
      //   `${ctx.session.userForm.username} запрошує тебе на подію ${eventName} ${eventDate}. Обговори деталі...`,
      //   {
      //     parse_mode: 'Markdown',
      //     reply_markup: {
      //       inline_keyboard: [
      //         [
      //           {
      //             text: '❤️',
      //             callback_data: `like:${userId}:${mentionMessage}`,
      //           },
      //           {
      //             text: '👎',
      //             callback_data: `dislike:${userId}:${
      //               ctx.from!.username
      //             }`,
      //           },
      //         ],
      //       ],
      //     },
      //   }
      // );

      //         const regex = /^(like|dislike):(.+)$/;
      //         userEvents.action(regex, async (ctx) => {
      //           console.log('in userEvents');
      //           const actionType = ctx.match[1]; // 'like' or 'dislike'
      //           const initiatorUserId = ctx.match[2]; // User ID of the initiator
      //           const initiatorUsername = ctx.match[3]; // Username of the initiator
      //           if (actionType === 'like') {
      //             // Notify the sender about the ❤️
      //             try {
      //               await ctx.telegram.sendMessage(
      //                 initiatorUserId,
      //                 `@${
      //                   ctx.from!.username
      //                 } прийняв ваше твоє запрошення на подію ${eventName} ${eventDate}. Обговори деталі...`
      //               );
      //               await ctx.reply(`@${initiatorUsername}
      // Ти прийняв запрошення на подію 🥳. Бажаю весело провести час 👋`);
      //             } catch (error) {
      //               console.error('Error sending notification:', error);
      //             }
      //           }
      //         });
    });
    lookForMatch.hears('❤️‍🔥', async (ctx) => {
      await this.registerUserLastActivity(ctx.session.userForm.userId);
      if (
        !ctx.session.userForm.isPremium &&
        ctx.session.userForm.likesSentCount >= MAX_LIKES_LIMIT
      ) {
        await ctx.reply(
          'Вибач, але ти досяг ліміту лайків на сьогодні, купи преміум підписку або почекай до завтра'
        );
        return;
      }

      const symbolCount = ctx.session.userForm.isPremium ? 300 : 70;
      const premiumMessage = ctx.session.userForm.isPremium
        ? 'картинку, відео, голосове повідомлення, кружок або'
        : '';
      await ctx.reply(
        `Можеш відправити ${premiumMessage} коротке текстове повідомлення на *${symbolCount}* символів разом з вподобайкою`,
        { parse_mode: 'Markdown' }
      );
      if (!ctx.session.userForm.isPremium) {
        ctx.session.userForm.likesSentCount++;
        await this.db
          .collection('users')
          .updateOne(
            { userId: ctx.session.userForm.userId },
            { $set: { likesSentCount: ctx.session.userForm.likesSentCount } }
          );
      }
      this.isLikeMessage = true;
    });
    lookForMatch.hears('👎', async (ctx) => {
      this.isLikeMessage = false;
      await this.registerUserLastActivity(ctx.from.id);
      currentUserIndex++;
      this.isProfilesWithLocationEnded = await this.sendUserDetails(
        userMatchForms as unknown as UserForm[],
        currentUserIndex,
        ctx
      );
      if (currentUserIndex > 0) {
        const previousUser = userMatchForms[currentUserIndex - 1];
        const previousUserId = previousUser.userId;
        const viewerUserId = ctx.session.userForm.userId;
        if (previousUserId) {
          await this.db.collection('viewed_profiles').insertOne({
            viewerUserId: viewerUserId,
            viewedUserId: previousUserId,
            expiryTimestamp: new Date(Date.now() + TIME_TO_VIEW_EXPIRE),
          });
          await this.db
            .collection('users')
            .updateOne(
              { userId: previousUserId },
              { $inc: { dislikesCount: 1 } }
            );
        }
      }
      if (this.isProfilesWithLocationEnded && !this.isProfilesEnded) {
        userMatchForms = await this.loadProfilesWithoutLocationSpecified(ctx);
        currentUserIndex = 0;
        this.isProfilesEnded = await this.sendUserDetails(
          userMatchForms as unknown as UserForm[],
          currentUserIndex,
          ctx
        );
      }
      if (this.isProfilesEnded) {
        await ctx.reply(
          'Більше немає людей, які підходять під твої запити',
          Markup.removeKeyboard()
        );
      }
    });
    lookForMatch.hears('Скарга', async (ctx) => {
      this.reportedUserId = userMatchForms[currentUserIndex]?.userId;
      ctx.scene.enter('complaint');
      currentUserIndex++;
    });
    this.addCommands(lookForMatch);
    lookForMatch.on('text', async (ctx) => {
      if (this.isLikeMessage) {
        const allowedSymbolsLength = ctx.session.userForm.isPremium ? 300 : 70;
        if (ctx.message.text.length > allowedSymbolsLength) {
          await ctx.reply(
            `Занадто велике повідомлення, тобі доступно лише *${allowedSymbolsLength}*`,
            {
              parse_mode: 'Markdown',
            }
          );
        } else {
          const previousUser = userMatchForms[currentUserIndex];
          const previousUserId = previousUser.userId;
          const viewerUserId = ctx.session.userForm.userId;
          if (previousUserId) {
            await this.db.collection('viewed_profiles').insertOne({
              viewerUserId: viewerUserId,
              viewedUserId: previousUserId,
              expiryTimestamp: new Date(Date.now() + TIME_TO_VIEW_EXPIRE),
            });
            let username = ctx.from?.username;
            if (username) {
              username = '@' + username;
            }
            const userId = ctx.from!.id;
            const userLink = `tg://user?id=${userId}`;
            const mentionMessage =
              username || `[${ctx.from?.first_name}](${userLink})`;
            let message = `👀Один краш поставив вподобайку твоєму профілю, щоб переглянути хто це перейди у *архів лайків* 🗄`;
            await this.db
              .collection('users')
              .updateOne(
                { userId: previousUserId },
                { $inc: { likesCount: 1 } }
              );
            if (this.isLookingForEventMatch) {
              message = `👀Один краш запрошує тебе кудись, щоб переглянути хто це перейди у *архів лайків* 🗄`;
            }
            this.insertData = {
              senderId: userId,
              receiverId: previousUserId,
              senderMentionMessage: mentionMessage,
              likeMessage: {
                type: 'text',
                content: ctx.message.text,
              },
            };
            if (ctx.session.eventDetails?.eventId) {
              this.insertData.eventId = ctx.session.eventDetails.eventId;
            }
            const updateQuery: {
              senderId: number;
              receiverId: number;
              eventId?: number;
            } = {
              senderId: this.insertData.senderId,
              receiverId: this.insertData.receiverId,
            };
            if (this.insertData.eventId) {
              updateQuery.eventId = this.insertData.eventId;
            }
            this.isLikeMessage = false;
            await ctx.reply(
              '✅ Відправили твоє повідомлення',
              Markup.keyboard([['❤️', '❤️‍🔥', '👎', 'Скарга']]).resize()
            );
            currentUserIndex++;
            this.isProfilesWithLocationEnded = await this.sendUserDetails(
              userMatchForms as unknown as UserForm[],
              currentUserIndex,
              ctx
            );
            if (this.isProfilesWithLocationEnded && !this.isProfilesEnded) {
              userMatchForms = await this.loadProfilesWithoutLocationSpecified(
                ctx
              );
              currentUserIndex = 0;
              this.isProfilesEnded = await this.sendUserDetails(
                userMatchForms as unknown as UserForm[],
                currentUserIndex,
                ctx
              );
            }
            if (this.isProfilesEnded) {
              await ctx.reply(
                'Більше немає людей, які підходять під твої запити',
                Markup.removeKeyboard()
              );
            }
            try {
              await ctx.telegram.sendMessage(
                this.insertData.receiverId,
                message,
                {
                  parse_mode: 'Markdown',
                  reply_markup: {
                    keyboard: [['🗄 Перейти у архів']],
                    resize_keyboard: true,
                  },
                }
              );
              await this.db.collection('matches').updateOne(
                updateQuery,
                {
                  $set: this.insertData,
                },
                {
                  upsert: true,
                }
              );
            } catch (error) {
              console.error('Like message send error: ', error);
            }
          }
        }
      } else {
        await ctx.reply(
          '❤️ — якщо людина подобається, 👎 — якщо ні, скарга — якщо людина, на твою думку, погано себе веде. Все просто 😉'
        );
      }
    });
    lookForMatch.on('voice', async (ctx) => {
      if (this.isLikeMessage) {
        if (!ctx.session.userForm.isPremium) {
          await ctx.reply(
            'Відправка голосових повідомлень доступна тільки преміум користувачам'
          );
        } else {
          if (ctx.message.voice.duration > 60) {
            await ctx.reply(
              'Занадто довге голосове, постарайся вкластись у 60 секунд'
            );
          } else {
            const previousUser = userMatchForms[currentUserIndex];
            const previousUserId = previousUser.userId;
            const viewerUserId = ctx.session.userForm.userId;
            if (previousUserId) {
              await this.db.collection('viewed_profiles').insertOne({
                viewerUserId: viewerUserId,
                viewedUserId: previousUserId,
                expiryTimestamp: new Date(Date.now() + TIME_TO_VIEW_EXPIRE),
              });
              let username = ctx.from?.username;
              if (username) {
                username = '@' + username;
              }
              const userId = ctx.from!.id;
              const userLink = `tg://user?id=${userId}`;
              const mentionMessage =
                username || `[${ctx.from?.first_name}](${userLink})`;
              let message = `👀Один краш поставив вподобайку твоєму профілю, щоб переглянути хто це перейди у *архів лайків* 🗄`;
              await this.db
                .collection('users')
                .updateOne(
                  { userId: previousUserId },
                  { $inc: { likesCount: 1 } }
                );
              if (this.isLookingForEventMatch) {
                message = `👀Один краш запрошує тебе кудись, щоб переглянути хто це перейди у *архів лайків* 🗄`;
              }
              this.insertData = {
                senderId: userId,
                receiverId: previousUserId,
                senderMentionMessage: mentionMessage,
                likeMessage: {
                  type: 'voice',
                  content: ctx.message.voice.file_id,
                },
              };
              if (ctx.session.eventDetails?.eventId) {
                this.insertData.eventId = ctx.session.eventDetails.eventId;
              }
              const updateQuery: {
                senderId: number;
                receiverId: number;
                eventId?: number;
              } = {
                senderId: this.insertData.senderId,
                receiverId: this.insertData.receiverId,
              };
              if (this.insertData.eventId) {
                updateQuery.eventId = this.insertData.eventId;
              }
              this.isLikeMessage = false;
              await ctx.reply(
                '✅ Відправили твоє повідомлення',
                Markup.keyboard([['❤️', '❤️‍🔥', '👎', 'Скарга']]).resize()
              );
              currentUserIndex++;
              this.isProfilesWithLocationEnded = await this.sendUserDetails(
                userMatchForms as unknown as UserForm[],
                currentUserIndex,
                ctx
              );
              if (this.isProfilesWithLocationEnded && !this.isProfilesEnded) {
                userMatchForms =
                  await this.loadProfilesWithoutLocationSpecified(ctx);
                currentUserIndex = 0;
                this.isProfilesEnded = await this.sendUserDetails(
                  userMatchForms as unknown as UserForm[],
                  currentUserIndex,
                  ctx
                );
              }
              if (this.isProfilesEnded) {
                await ctx.reply(
                  'Більше немає людей, які підходять під твої запити',
                  Markup.removeKeyboard()
                );
              }
              try {
                await ctx.telegram.sendMessage(
                  this.insertData.receiverId,
                  message,
                  {
                    parse_mode: 'Markdown',
                    reply_markup: {
                      keyboard: [['🗄 Перейти у архів']],
                      resize_keyboard: true,
                    },
                  }
                );
                await this.db.collection('matches').updateOne(
                  updateQuery,
                  {
                    $set: this.insertData,
                  },
                  {
                    upsert: true,
                  }
                );
              } catch (error) {
                console.error('Like message send error: ', error);
              }
            }
          }
        }
      } else {
        await ctx.reply(
          '❤️ — якщо людина подобається, 👎 — якщо ні, скарга — якщо людина, на твою думку, погано себе веде. Все просто 😉'
        );
      }
    });
    lookForMatch.on('photo', async (ctx) => {
      if (this.isLikeMessage) {
        if (!ctx.session.userForm.isPremium) {
          await ctx.reply(
            'Відправка картинок доступна тільки преміум користувачам'
          );
        } else {
          const previousUser = userMatchForms[currentUserIndex];
          const previousUserId = previousUser.userId;
          const viewerUserId = ctx.session.userForm.userId;
          if (previousUserId) {
            await this.db.collection('viewed_profiles').insertOne({
              viewerUserId: viewerUserId,
              viewedUserId: previousUserId,
              expiryTimestamp: new Date(Date.now() + TIME_TO_VIEW_EXPIRE),
            });
            let username = ctx.from?.username;
            if (username) {
              username = '@' + username;
            }
            const userId = ctx.from!.id;
            const userLink = `tg://user?id=${userId}`;
            const mentionMessage =
              username || `[${ctx.from?.first_name}](${userLink})`;
            let message = `👀Один краш поставив вподобайку твоєму профілю, щоб переглянути хто це перейди у *архів лайків* 🗄`;
            await this.db
              .collection('users')
              .updateOne(
                { userId: previousUserId },
                { $inc: { likesCount: 1 } }
              );
            if (this.isLookingForEventMatch) {
              message = `👀Один краш запрошує тебе кудись, щоб переглянути хто це перейди у *архів лайків* 🗄`;
            }
            const caption = ctx.message.caption || '';
            const photos = ctx.message.photo.sort((a, b) => {
              const resolutionA = a.width * a.height;
              const resolutionB = b.width * b.height;
              return resolutionB - resolutionA;
            });
            this.insertData = {
              senderId: userId,
              receiverId: previousUserId,
              senderMentionMessage: mentionMessage,
              likeMessage: {
                type: 'photo',
                content: photos[0].file_id,
                caption: caption,
              },
            };
            if (ctx.session.eventDetails?.eventId) {
              this.insertData.eventId = ctx.session.eventDetails.eventId;
            }
            const updateQuery: {
              senderId: number;
              receiverId: number;
              eventId?: number;
            } = {
              senderId: this.insertData.senderId,
              receiverId: this.insertData.receiverId,
            };
            if (this.insertData.eventId) {
              updateQuery.eventId = this.insertData.eventId;
            }
            this.isLikeMessage = false;
            await ctx.reply(
              '✅ Відправили твоє повідомлення',
              Markup.keyboard([['❤️', '❤️‍🔥', '👎', 'Скарга']]).resize()
            );
            currentUserIndex++;
            this.isProfilesWithLocationEnded = await this.sendUserDetails(
              userMatchForms as unknown as UserForm[],
              currentUserIndex,
              ctx
            );
            if (this.isProfilesWithLocationEnded && !this.isProfilesEnded) {
              userMatchForms = await this.loadProfilesWithoutLocationSpecified(
                ctx
              );
              currentUserIndex = 0;
              this.isProfilesEnded = await this.sendUserDetails(
                userMatchForms as unknown as UserForm[],
                currentUserIndex,
                ctx
              );
            }
            if (this.isProfilesEnded) {
              await ctx.reply(
                'Більше немає людей, які підходять під твої запити',
                Markup.removeKeyboard()
              );
            }
            try {
              await ctx.telegram.sendMessage(
                this.insertData.receiverId,
                message,
                {
                  parse_mode: 'Markdown',
                  reply_markup: {
                    keyboard: [['🗄 Перейти у архів']],
                    resize_keyboard: true,
                  },
                }
              );
              await this.db.collection('matches').updateOne(
                updateQuery,
                {
                  $set: this.insertData,
                },
                {
                  upsert: true,
                }
              );
            } catch (error) {
              console.error('Like message send error: ', error);
            }
          }
        }
      } else {
        await ctx.reply(
          '❤️ — якщо людина подобається, 👎 — якщо ні, скарга — якщо людина, на твою думку, погано себе веде. Все просто 😉'
        );
      }
    });
    lookForMatch.on('video', async (ctx) => {
      if (this.isLikeMessage) {
        if (!ctx.session.userForm.isPremium) {
          await ctx.reply(
            'Відправка відео доступна тільки преміум користувачам'
          );
        } else {
          if (ctx.message.video.duration > 60) {
            await ctx.reply(
              'Відео занадто довге, будь-ласка, відправ відео, яке не довше 60 секунд'
            );
          } else {
            const previousUser = userMatchForms[currentUserIndex];
            const previousUserId = previousUser.userId;
            const viewerUserId = ctx.session.userForm.userId;
            if (previousUserId) {
              await this.db.collection('viewed_profiles').insertOne({
                viewerUserId: viewerUserId,
                viewedUserId: previousUserId,
                expiryTimestamp: new Date(Date.now() + TIME_TO_VIEW_EXPIRE),
              });
              let username = ctx.from?.username;
              if (username) {
                username = '@' + username;
              }
              const userId = ctx.from!.id;
              const userLink = `tg://user?id=${userId}`;
              const mentionMessage =
                username || `[${ctx.from?.first_name}](${userLink})`;
              let message = `👀Один краш поставив вподобайку твоєму профілю, щоб переглянути хто це перейди у *архів лайків* 🗄`;
              await this.db
                .collection('users')
                .updateOne(
                  { userId: previousUserId },
                  { $inc: { likesCount: 1 } }
                );
              if (this.isLookingForEventMatch) {
                message = `👀Один краш запрошує тебе кудись, щоб переглянути хто це перейди у *архів лайків* 🗄`;
              }
              const caption = ctx.message.caption || '';
              this.insertData = {
                senderId: userId,
                receiverId: previousUserId,
                senderMentionMessage: mentionMessage,
                likeMessage: {
                  type: 'video',
                  content: ctx.message.video.file_id,
                  caption: caption,
                },
              };
              if (ctx.session.eventDetails?.eventId) {
                this.insertData.eventId = ctx.session.eventDetails.eventId;
              }
              const updateQuery: {
                senderId: number;
                receiverId: number;
                eventId?: number;
              } = {
                senderId: this.insertData.senderId,
                receiverId: this.insertData.receiverId,
              };
              if (this.insertData.eventId) {
                updateQuery.eventId = this.insertData.eventId;
              }
              this.isLikeMessage = false;
              await ctx.reply(
                '✅ Відправили твоє повідомлення',
                Markup.keyboard([['❤️', '❤️‍🔥', '👎', 'Скарга']]).resize()
              );
              currentUserIndex++;
              this.isProfilesWithLocationEnded = await this.sendUserDetails(
                userMatchForms as unknown as UserForm[],
                currentUserIndex,
                ctx
              );
              if (this.isProfilesWithLocationEnded && !this.isProfilesEnded) {
                userMatchForms =
                  await this.loadProfilesWithoutLocationSpecified(ctx);
                currentUserIndex = 0;
                this.isProfilesEnded = await this.sendUserDetails(
                  userMatchForms as unknown as UserForm[],
                  currentUserIndex,
                  ctx
                );
              }
              if (this.isProfilesEnded) {
                await ctx.reply(
                  'Більше немає людей, які підходять під твої запити',
                  Markup.removeKeyboard()
                );
              }
              try {
                await ctx.telegram.sendMessage(
                  this.insertData.receiverId,
                  message,
                  {
                    parse_mode: 'Markdown',
                    reply_markup: {
                      keyboard: [['🗄 Перейти у архів']],
                      resize_keyboard: true,
                    },
                  }
                );
                await this.db.collection('matches').updateOne(
                  updateQuery,
                  {
                    $set: this.insertData,
                  },
                  {
                    upsert: true,
                  }
                );
              } catch (error) {
                console.error('Like message send error: ', error);
              }
            }
          }
        }
      } else {
        await ctx.reply(
          '❤️ — якщо людина подобається, 👎 — якщо ні, скарга — якщо людина, на твою думку, погано себе веде. Все просто 😉'
        );
      }
    });
    lookForMatch.on('video_note', async (ctx) => {
      if (this.isLikeMessage) {
        if (!ctx.session.userForm.isPremium) {
          await ctx.reply(
            'Відправка кружків доступна тільки преміум користувачам'
          );
        } else {
          if (ctx.message.video_note.duration >= 60) {
            await ctx.reply(
              'Кружок занадто довгий, будь-ласка, відправ відео, яке не довше 60 секунд'
            );
          } else {
            const previousUser = userMatchForms[currentUserIndex];
            const previousUserId = previousUser.userId;
            const viewerUserId = ctx.session.userForm.userId;
            if (previousUserId) {
              await this.db.collection('viewed_profiles').insertOne({
                viewerUserId: viewerUserId,
                viewedUserId: previousUserId,
                expiryTimestamp: new Date(Date.now() + TIME_TO_VIEW_EXPIRE),
              });
              let username = ctx.from?.username;
              if (username) {
                username = '@' + username;
              }
              const userId = ctx.from!.id;
              const userLink = `tg://user?id=${userId}`;
              const mentionMessage =
                username || `[${ctx.from?.first_name}](${userLink})`;
              let message = `👀Один краш поставив вподобайку твоєму профілю, щоб переглянути хто це перейди у *архів лайків* 🗄`;
              await this.db
                .collection('users')
                .updateOne(
                  { userId: previousUserId },
                  { $inc: { likesCount: 1 } }
                );
              if (this.isLookingForEventMatch) {
                message = `👀Один краш запрошує тебе кудись, щоб переглянути хто це перейди у *архів лайків* 🗄`;
              }
              this.insertData = {
                senderId: userId,
                receiverId: previousUserId,
                senderMentionMessage: mentionMessage,
                likeMessage: {
                  type: 'video_note',
                  content: ctx.message.video_note.file_id,
                },
              };
              if (ctx.session.eventDetails?.eventId) {
                this.insertData.eventId = ctx.session.eventDetails.eventId;
              }
              const updateQuery: {
                senderId: number;
                receiverId: number;
                eventId?: number;
              } = {
                senderId: this.insertData.senderId,
                receiverId: this.insertData.receiverId,
              };
              if (this.insertData.eventId) {
                updateQuery.eventId = this.insertData.eventId;
              }
              this.isLikeMessage = false;
              await ctx.reply(
                '✅ Відправили твоє повідомлення',
                Markup.keyboard([['❤️', '❤️‍🔥', '👎', 'Скарга']]).resize()
              );
              currentUserIndex++;
              this.isProfilesWithLocationEnded = await this.sendUserDetails(
                userMatchForms as unknown as UserForm[],
                currentUserIndex,
                ctx
              );
              if (this.isProfilesWithLocationEnded && !this.isProfilesEnded) {
                userMatchForms =
                  await this.loadProfilesWithoutLocationSpecified(ctx);
                currentUserIndex = 0;
                this.isProfilesEnded = await this.sendUserDetails(
                  userMatchForms as unknown as UserForm[],
                  currentUserIndex,
                  ctx
                );
              }
              if (this.isProfilesEnded) {
                await ctx.reply(
                  'Більше немає людей, які підходять під твої запити',
                  Markup.removeKeyboard()
                );
              }
              try {
                await ctx.telegram.sendMessage(
                  this.insertData.receiverId,
                  message,
                  {
                    parse_mode: 'Markdown',
                    reply_markup: {
                      keyboard: [['🗄 Перейти у архів']],
                      resize_keyboard: true,
                    },
                  }
                );
                await this.db.collection('matches').updateOne(
                  updateQuery,
                  {
                    $set: this.insertData,
                  },
                  {
                    upsert: true,
                  }
                );
              } catch (error) {
                console.error('Like message send error: ', error);
              }
            }
          }
        }
      } else {
        await ctx.reply(
          '❤️ — якщо людина подобається, 👎 — якщо ні, скарга — якщо людина, на твою думку, погано себе веде. Все просто 😉'
        );
      }
    });
    lookForMatch.on('message', async (ctx) => {
      await ctx.reply(
        '❤️ — якщо людина подобається, 👎 — якщо ні, скарга — якщо людина, на твою думку, погано себе веде. Все просто 😉'
      );
    });
    lookForMatch.leave(async () => {
      this.isLookingForEventMatch = false;
      console.log('leave scene');
      if (job) {
        console.log('leave job');
        job.stop();
      }
    });
    return lookForMatch;
  }

  complaintScene(): Scenes.BaseScene<MySceneContext> {
    const complaint = new Scenes.BaseScene<MySceneContext>('complaint');
    complaint.enter(async (ctx) => {
      if (!this.reportedUserId) {
        await ctx.reply(
          'Такого користувача не знайдено, зверніться у підтримку'
        );

        await this.db.collection('viewed_profiles').insertOne({
          viewerUserId: ctx.from!.id,
          viewedUserId: this.reportedUserId,
          expiryTimestamp: new Date(Date.now() + TIME_TO_VIEW_EXPIRE),
        });
        this.reportedUserId = undefined;
        await ctx.scene.leave();
        return;
      }
      await ctx.reply(
        `За бажанням, вкажіть причину скарги`,
        Markup.keyboard([['Пропустити']])
          .oneTime()
          .resize()
      );
    });
    const handleComplaint = async (
      ctx: MySceneContext,
      complaintDescription: string
    ) => {
      const existingComplaint = await this.db
        .collection('complaints')
        .findOne({ userId: this.reportedUserId });

      const updateData = {
        $inc: { complaintsNum: 1 },
        $push: { descriptions: complaintDescription },
      };

      if (!existingComplaint) {
        await this.db.collection('complaints').insertOne({
          userId: this.reportedUserId,
          complaintsNum: 1,
          descriptions: [complaintDescription],
        });
      } else {
        await this.db
          .collection('complaints')
          .updateOne({ userId: this.reportedUserId }, updateData);
      }

      await ctx.reply(
        'Ви відправили скаргу на профіль. Дякуємо за Ваше повідомлення, ми розберемось з порушником 👮‍♂️',
        Markup.removeKeyboard()
      );
      await this.db.collection('viewed_profiles').insertOne({
        viewerUserId: ctx.from!.id,
        viewedUserId: this.reportedUserId,
        expiryTimestamp: new Date(Date.now() + TIME_TO_VIEW_EXPIRE),
      });
      this.reportedUserId = undefined;
      await ctx.scene.enter('lookForMatch');
    };

    complaint.hears('Пропустити', async (ctx) => {
      await handleComplaint(ctx, '');
    });
    this.addCommands(complaint);

    complaint.on('text', async (ctx) => {
      const complaintDescription = ctx.message.text;
      await handleComplaint(ctx, complaintDescription);
    });

    return complaint;
  }

  likeArchiveScene(): Scenes.BaseScene<MySceneContext> {
    const likeArchive = new Scenes.BaseScene<MySceneContext>('likeArchive');
    let matches: Match[] = [];
    let likeMatches: Match[] = [];
    let botEventMatches: Match[] = [];
    let userEventMatches: Match[] = [];
    let matchesArray: Match[] = [];
    let isBotEvent = false;
    let isUserEvent = false;
    const getUserProfile = async (match: Match, ctx: MySceneContext) => {
      const user = (await this.db.collection('users').findOne({
        userId: match.senderId,
      })) as unknown as UserForm;
      if (user) {
        let mediaGroup;
        if (match.likeMessage) {
          mediaGroup = this.showUserProfile(
            user,
            ctx.session.userForm,
            match.likeMessage
          );
        } else {
          mediaGroup = this.showUserProfile(user, ctx.session.userForm);
        }

        await ctx.replyWithMediaGroup(mediaGroup);
        if (user.about?.type === 'voice') {
          await ctx.replyWithVoice(user.about.content, {
            caption: '*Про себе:*',
            parse_mode: 'Markdown',
          });
        }
        if (match.likeMessage && match.likeMessage.type === 'voice') {
          await ctx.replyWithVoice(match.likeMessage.content, {
            caption: '*Повідомлення від користувача:*',
            parse_mode: 'Markdown',
          });
        }
        if (match.likeMessage && match.likeMessage.type === 'photo') {
          await ctx.replyWithPhoto(match.likeMessage.content, {
            caption: `*Повідомлення від користувача:* ${match.likeMessage.caption}`,
            parse_mode: 'Markdown',
          });
        }
        if (match.likeMessage && match.likeMessage.type === 'video') {
          await ctx.replyWithVideo(match.likeMessage.content, {
            caption: `*Повідомлення від користувача:* ${match.likeMessage.caption}`,
            parse_mode: 'Markdown',
          });
        }
        if (match.likeMessage && match.likeMessage.type === 'video_note') {
          await ctx.reply('*Повідомлення від користувача:*', {
            parse_mode: 'Markdown',
          });
          await ctx.replyWithVideoNote(match.likeMessage.content);
        }
      } else {
        await ctx.reply('Схоже користувач приховав свій профіль');
      }
    };
    async function handleBotEvent(
      ctx: MySceneContext,
      event: Event,
      isUserEvent: boolean
    ) {
      if (isUserEvent) {
        await ctx.reply('👆🏻 Відгукнувся на 👇🏻');
      } else {
        await ctx.reply('👆🏻 Запрошує тебе на 👇🏻');
      }
      let caption = `*Назва події:* ${event.eventName}\n*Дата та час події:* ${event.date}\n*Місто:* ${event.location}`;
      if (event.about) {
        caption = `${caption}\n*Деталі: * ${event.about}`;
      }
      if (event.mediaIds && event.mediaIds.length > 0) {
        const mediaGroup: MediaGroup = event.mediaIds.map(
          (mediaObj: { type: string; id: string }, index: number) => ({
            type: mediaObj.type as 'document',
            media: mediaObj.id,
            caption: index === 0 ? caption : undefined,
            parse_mode: index === 0 ? 'Markdown' : undefined,
          })
        );
        await ctx.replyWithMediaGroup(mediaGroup);
      } else {
        await ctx.reply(caption, {
          parse_mode: 'Markdown',
        });
      }
    }
    likeArchive.enter(async (ctx) => {
      likeMatches = [];
      botEventMatches = [];
      userEventMatches = [];
      matchesArray = [];
      if (!this.isConnectionOpened) {
        await this.client.connect();
        const userForm = await this.getUserFormDataFromDatabase(ctx.from!.id);
        ctx.session.userForm = new UserFormModel({});
        Object.assign(ctx.session.userForm, userForm);
      }
      if (!ctx.session.userForm?.userId) {
        const userForm = await this.getUserFormDataFromDatabase(ctx.from!.id);
        ctx.session.userForm = new UserFormModel({});
        Object.assign(ctx.session.userForm, userForm);
      }
      if (!ctx.session.eventDetails) {
        ctx.session.eventDetails = { lookingFor: '', eventId: 0 };
      }
      matches = (await this.db
        .collection('matches')
        .find({ receiverId: ctx.from!.id })
        .toArray()) as unknown as Match[];

      matches.forEach((match) => {
        if (!match.eventId && !match.isUserEvent) {
          likeMatches.push(match);
        } else if (match.eventId && !match.isUserEvent) {
          botEventMatches.push(match);
        } else if (match.eventId && match.isUserEvent) {
          userEventMatches.push(match);
        }
      });
      const keyboard = [];
      if (likeMatches.length > 0) {
        keyboard.push('💝');
      }
      if (botEventMatches.length > 0) {
        keyboard.push('🎟️');
      }
      if (userEventMatches.length > 0) {
        keyboard.push('💌');
      }
      await ctx.reply(
        `💝 Кількіть твоїх вподобайок — *${likeMatches.length}*\n🎟️ Кількість запрошень на подію — *${botEventMatches.length}*\n💌 Відгукнулись на твоє запрошення — *${userEventMatches.length}*`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [keyboard],
            resize_keyboard: true,
          },
        }
      );
      if (keyboard.length < 1) {
        await ctx.reply(
          `Вподобайок поки немає\nМожеш розпочати пошук або переглянути свій профіль\n👫 — Розпочати звичайний пошук\n👤 — Переглянути свій профіль`,
          Markup.keyboard([['👫', '👤']])
            .oneTime()
            .resize()
        );
      }
    });
    likeArchive.hears('💝', async (ctx) => {
      matchesArray = likeMatches;
      isBotEvent = false;
      isUserEvent = false;
      if (matchesArray.length < 1) {
        await ctx.reply('Вподобайок поки немає');
        return;
      }
      await ctx.reply('Дивимось хто поставив тобі вподобайку... ❤️', {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [['❤️', '👎']],
          resize_keyboard: true,
        },
      });
      await getUserProfile(matchesArray[0], ctx);
    });
    likeArchive.hears('🎟️', async (ctx) => {
      matchesArray = botEventMatches;
      isBotEvent = true;
      isUserEvent = false;
      if (matchesArray.length < 1) {
        await ctx.reply('Вподобайок поки немає');
        return;
      }
      await ctx.reply('Дивимось хто запросив тебе на подію... 🎟️', {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [['❤️', '👎']],
          resize_keyboard: true,
        },
      });
      await getUserProfile(matchesArray[0], ctx);
      const event = (await this.db
        .collection('bot_events')
        .findOne({ eventId: matchesArray[0].eventId })) as unknown as Event;
      if (event) {
        await handleBotEvent(ctx, event, false);
      } else {
        ctx.reply('Схоже іцініатор видалив цю подію');
      }
    });
    likeArchive.hears('💌', async (ctx) => {
      matchesArray = userEventMatches;
      isBotEvent = false;
      isUserEvent = true;
      if (matchesArray.length < 1) {
        await ctx.reply('Вподобайок поки немає');
        return;
      }
      await ctx.reply('Дивимось хто відгукнувся на твої події... 💌', {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [['❤️', '👎']],
          resize_keyboard: true,
        },
      });
      await getUserProfile(matchesArray[0], ctx);

      let eventId: number = NaN;
      if (matchesArray[0].eventId) {
        eventId = matchesArray[0].eventId as number;
      }

      const event = (await this.getEventFromDatabase(
        ctx.from.id,
        eventId
      )) as unknown as Event;

      if (event) {
        await handleBotEvent(ctx, event, true);
      } else {
        ctx.reply('Схоже іцініатор видалив цю подію');
      }
    });
    likeArchive.hears('❤️', async (ctx) => {
      const senderUser = await this.getUserFormDataFromDatabase(matchesArray[0].senderId) as unknown as UserForm
      const currentUser = this.showUserProfile(
        ctx.session.userForm,
        senderUser
      );
      let username = ctx.from?.username;
      if (username) {
        username = '@' + username;
      }
      const userId = ctx.from!.id;
      const userLink = `tg://user?id=${userId}`;
      const mentionMessage =
        username || `[${ctx.from?.first_name}](${userLink})`;
      try {
        await ctx.reply(
          `Бажаємо весело провести час\n*Посилання на користувача:* ${matchesArray[0].senderMentionMessage}`,
          {
            parse_mode: 'Markdown',
          }
        );
        await this.db
          .collection('users')
          .updateOne(
            { userId: matchesArray[0].senderId },
            { $inc: { likesCount: 1 } }
          );
        await this.db.collection('matches').deleteMany({
          $or: [
            {
              senderId: ctx.session.userForm.userId,
              receiverId: matchesArray[0].senderId,
            },
            {
              senderId: matchesArray[0].senderId,
              receiverId: ctx.session.userForm.userId,
            },
          ],
        });
        await ctx.telegram.sendMediaGroup(
          matchesArray[0].senderId,
          currentUser
        );
        if (ctx.session.userForm.about?.type === 'voice') {
          await ctx.telegram.sendVoice(
            matchesArray[0].senderId,
            ctx.session.userForm.about.content,
            {
              caption: '*Про себе:*',
              parse_mode: 'Markdown',
            }
          );
        }
        let caption = `Ви отримали взаємний лайк. Бажаємо весело провести час\nПосилання на користувача: ${mentionMessage}`;
        if (isBotEvent || isUserEvent) {
          caption = `Хтось відгукнувся на ваше запрошення. Бажаємо весело провести час\nПосилання на користувача: ${mentionMessage}`;
        }
        await ctx.telegram.sendMessage(matchesArray[0].senderId, caption, {
          parse_mode: 'Markdown',
        });
      } catch (error) {
        console.error('Like archive error: ', error);
      }
      matchesArray.splice(0, 1);
      if (matchesArray[0]) {
        const user = (await this.db.collection('users').findOne({
          userId: matchesArray[0].senderId,
        })) as unknown as UserForm;
        let event = null;
        if (isBotEvent) {
          event = await this.db
            .collection('bot_events')
            .findOne({ eventId: matchesArray[0].eventId });
        }
        if (user) {
          let mediaGroup;
          if (matchesArray[0].likeMessage) {
            mediaGroup = this.showUserProfile(
              user,
              ctx.session.userForm,
              matchesArray[0].likeMessage
            );
          } else {
            mediaGroup = this.showUserProfile(user, ctx.session.userForm);
          }
          await ctx.replyWithMediaGroup(mediaGroup);
          if (user.about?.type === 'voice') {
            await ctx.replyWithVoice(user.about.content, {
              caption: '*Про себе:*',
              parse_mode: 'Markdown',
            });
          }
          if (
            matchesArray[0].likeMessage &&
            matchesArray[0].likeMessage.type === 'voice'
          ) {
            await ctx.replyWithVoice(matchesArray[0].likeMessage.content, {
              caption: '*Повідомлення від користувача:*',
              parse_mode: 'Markdown',
            });
          }
          if (
            matchesArray[0].likeMessage &&
            matchesArray[0].likeMessage.type === 'photo'
          ) {
            await ctx.replyWithPhoto(matchesArray[0].likeMessage.content, {
              caption: `*Повідомлення від користувача:* ${matchesArray[0].likeMessage.caption}`,
              parse_mode: 'Markdown',
            });
          }
          if (
            matchesArray[0].likeMessage &&
            matchesArray[0].likeMessage.type === 'video'
          ) {
            await ctx.replyWithVideo(matchesArray[0].likeMessage.content, {
              caption: `*Повідомлення від користувача:* ${matchesArray[0].likeMessage.caption}`,
              parse_mode: 'Markdown',
            });
          }
          if (
            matchesArray[0].likeMessage &&
            matchesArray[0].likeMessage.type === 'video_note'
          ) {
            await ctx.reply('*Повідомлення від користувача:*', {
              parse_mode: 'Markdown',
            });
            await ctx.replyWithVideoNote(matchesArray[0].likeMessage.content);
          }
          if (isBotEvent && event) {
            await ctx.reply('👆🏻 Запрошує тебе на 👇🏻');
            let caption = `*Назва події:* ${event.eventName}\n*Дата та час події:* ${event.date}\n*Місто:* ${event.location}`;
            if (event.about) {
              caption = `${caption}\n*Деталі: * ${event.about}`;
            }
            if (event.mediaIds && event.mediaIds.length > 0) {
              const mediaGroup: MediaGroup = event.mediaIds.map(
                (mediaObj: { type: string; id: string }, index: number) => ({
                  type: mediaObj.type as 'document',
                  media: mediaObj.id,
                  caption: index === 0 ? caption : undefined,
                  parse_mode: index === 0 ? 'Markdown' : undefined,
                })
              );
              await ctx.replyWithMediaGroup(mediaGroup);
            } else {
              await ctx.reply(caption, {
                parse_mode: 'Markdown',
              });
            }
          } else if (isUserEvent && event) {
            await ctx.reply('👆🏻 Відгукнувся на  👇🏻');
            let caption = `*Назва події:* ${event.eventName}\n*Дата та час події:* ${event.date}\n*Місто:* ${event.location}`;
            if (event.about) {
              caption = `${caption}\n*Деталі: * ${event.about}`;
            }
            await ctx.reply(caption, {
              parse_mode: 'Markdown',
            });
          }
        }
      } else {
        if (
          likeMatches.length > 0 ||
          botEventMatches.length > 0 ||
          userEventMatches.length > 0
        ) {
          const keyboard = [];
          if (likeMatches.length > 0) {
            keyboard.push('💝');
          }
          if (botEventMatches.length > 0) {
            keyboard.push('🎟️');
          }
          if (userEventMatches.length > 0) {
            keyboard.push('💌');
          }
          await ctx.reply(
            `Поки все, але в тебе є ще вподобайки\n\n💝 Кількіть твоїх вподобайок — *${likeMatches.length}*\n🎟️ Кількість запрошень на подію — *${botEventMatches.length}*\n💌 Відгукнулись на твоє запрошення — *${userEventMatches.length}*`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                keyboard: [keyboard],
                resize_keyboard: true,
              },
            }
          );
        } else {
          await ctx.reply(
            `Схоже це все\n\n Можеш розпочати пошук або переглянути свій профіль\n👫 — Розпочати звичайний пошук\n👤 — Переглянути свій профіль`,
            Markup.keyboard([['👫', '👤']])
              .oneTime()
              .resize()
          );
        }
      }
    });
    likeArchive.hears('👎', async (ctx) => {
      try {
        await this.db
          .collection('users')
          .updateOne(
            { userId: matchesArray[0].senderId },
            { $inc: { dislikesCount: 1 } }
          );
        await this.db.collection('matches').deleteMany({
          $or: [
            {
              senderId: ctx.session.userForm.userId,
              receiverId: matchesArray[0].senderId,
            },
            {
              senderId: matchesArray[0].senderId,
              receiverId: ctx.session.userForm.userId,
            },
          ],
        });
        matchesArray.splice(0, 1);
        if (matchesArray[0]) {
          const user = (await this.db.collection('users').findOne({
            userId: matchesArray[0].senderId,
          })) as unknown as UserForm;
          let event = null;
          if (isBotEvent) {
            event = await this.db
              .collection('bot_events')
              .findOne({ eventId: matchesArray[0].eventId });
          }
          if (user) {
            let mediaGroup;
            if (matchesArray[0].likeMessage) {
              mediaGroup = this.showUserProfile(
                user,
                ctx.session.userForm,
                matchesArray[0].likeMessage
              );
            } else {
              mediaGroup = this.showUserProfile(user, ctx.session.userForm);
            }
            await ctx.replyWithMediaGroup(mediaGroup);
            if (user.about?.type === 'voice') {
              await ctx.replyWithVoice(user.about.content, {
                caption: '*Про себе:*',
                parse_mode: 'Markdown',
              });
            }
            if (
              matchesArray[0].likeMessage &&
              matchesArray[0].likeMessage.type === 'voice'
            ) {
              await ctx.replyWithVoice(matchesArray[0].likeMessage.content, {
                caption: '*Повідомлення від користувача:*',
                parse_mode: 'Markdown',
              });
            }
            if (
              matchesArray[0].likeMessage &&
              matchesArray[0].likeMessage.type === 'photo'
            ) {
              await ctx.replyWithPhoto(matchesArray[0].likeMessage.content, {
                caption: `*Повідомлення від користувача:* ${matchesArray[0].likeMessage.caption}`,
                parse_mode: 'Markdown',
              });
            }
            if (
              matchesArray[0].likeMessage &&
              matchesArray[0].likeMessage.type === 'video'
            ) {
              await ctx.replyWithVideo(matchesArray[0].likeMessage.content, {
                caption: `*Повідомлення від користувача:* ${matchesArray[0].likeMessage.caption}`,
                parse_mode: 'Markdown',
              });
            }
            if (
              matchesArray[0].likeMessage &&
              matchesArray[0].likeMessage.type === 'video_note'
            ) {
              await ctx.reply('*Повідомлення від користувача:*', {
                parse_mode: 'Markdown',
              });
              await ctx.replyWithVideoNote(matchesArray[0].likeMessage.content);
            }
            if (isBotEvent && event) {
              await ctx.reply('👆🏻 Запрошує тебе на 👇🏻');
              let caption = `*Назва події:* ${event.eventName}\n*Дата та час події:* ${event.date}\n*Місто:* ${event.location}`;
              if (event.about) {
                caption = `${caption}\n*Деталі: * ${event.about}`;
              }
              if (event.mediaIds && event.mediaIds.length > 0) {
                const mediaGroup: MediaGroup = event.mediaIds.map(
                  (mediaObj: { type: string; id: string }, index: number) => ({
                    type: mediaObj.type as 'document',
                    media: mediaObj.id,
                    caption: index === 0 ? caption : undefined,
                    parse_mode: index === 0 ? 'Markdown' : undefined,
                  })
                );
                await ctx.replyWithMediaGroup(mediaGroup);
              } else {
                await ctx.reply(caption, {
                  parse_mode: 'Markdown',
                });
              }
            } else if (isUserEvent && event) {
              await ctx.reply('👆🏻 Відгукнувся на  👇🏻');
              let caption = `*Назва події:* ${event.eventName}\n*Дата та час події:* ${event.date}\n*Місто:* ${event.location}`;
              if (event.about) {
                caption = `${caption}\n*Деталі: * ${event.about}`;
              }
              await ctx.reply(caption, {
                parse_mode: 'Markdown',
              });
            }
          } else {
            await ctx.reply(
              `Схоже це все\n\n Можеш розпочати пошук або переглянути свій профіль\n👫 — Розпочати звичайний пошук\n👤 — Переглянути свій профіль`,
              Markup.keyboard([['👫', '👤']])
                .oneTime()
                .resize()
            );
          }
        } else {
          if (
            likeMatches.length > 0 ||
            botEventMatches.length > 0 ||
            userEventMatches.length > 0
          ) {
            const keyboard = [];
            if (likeMatches.length > 0) {
              keyboard.push('💝');
            }
            if (botEventMatches.length > 0) {
              keyboard.push('🎟️');
            }
            if (userEventMatches.length > 0) {
              keyboard.push('💌');
            }
            await ctx.reply(
              `Поки все, але в тебе є ще вподобайки\n\n💝 Кількіть твоїх вподобайок — *${likeMatches.length}*\n🎟️ Кількість запрошень на подію — *${botEventMatches.length}*\n💌 Відгукнулись на твоє запрошення — *${userEventMatches.length}*`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  keyboard: [keyboard],
                  resize_keyboard: true,
                },
              }
            );
          } else {
            await ctx.reply(
              `Схоже це все\n\n Можеш розпочати пошук або переглянути свій профіль\n👫 — Розпочати звичайний пошук\n👤 — Переглянути свій профіль`,
              Markup.keyboard([['👫', '👤']])
                .oneTime()
                .resize()
            );
          }
        }
      } catch (error) {
        console.error('Like archive error: ', error);
      }
    });
    likeArchive.hears('👫', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    likeArchive.hears('👤', async (ctx) => {
      await ctx.scene.enter('userform');
    });
    this.addCommands(likeArchive);
    return likeArchive;
  }

  promocodeScene(): Scenes.BaseScene<MySceneContext> {
    const promocode = new Scenes.BaseScene<MySceneContext>('promocode');
    promocode.enter(async (ctx) => {
      await ctx.reply(
        'Якщо маєш промокод введи його тут 👇🏻',
        Markup.removeKeyboard()
      );
      if (!this.isConnectionOpened) {
        await this.client.connect();
      }
    });
    this.addCommands(promocode);
    promocode.hears('👤 Створити профіль', async (ctx) => {
      await ctx.scene.enter('userform');
    });
    promocode.on('text', async (ctx) => {
      const userCode = ctx.message.text;
      const promoCode = await this.db
        .collection('promocodes')
        .findOne({ promocode: userCode });
      if (promoCode) {
        const user = await this.db
          .collection('users')
          .findOne({ userId: ctx.from.id });
        if (user) {
          if (!ctx.session.userForm) {
            ctx.session.userForm = new UserFormModel({});
          }
          Object.assign(ctx.session.userForm, user);
          if (!promoCode.usedBy.includes(user.userId)) {
            if (promoCode.amount > 0) {
              if (promoCode.type === 'premium') {
                if (user.isPremium) {
                  await ctx.reply(
                    'На жаль, в тебе вже є преміум. Але цей промокод ти можеш подарувати своєму знайомому'
                  );
                } else {
                  let subscriptionDurationMs = 0;
                  switch (promoCode.premiumPeriod) {
                    case '1 місяць':
                      subscriptionDurationMs = SUBSCRIPTION_DURAION_1MONTH;
                      break;
                    case '6 місяців':
                      subscriptionDurationMs = SUBSCRIPTION_DURAION_6MONTHS;
                      break;
                    case '1 рік':
                      subscriptionDurationMs = SUBSCRIPTION_DURAION_1YEAR;
                      break;
                  }
                  const premiumEndTime = new Date();
                  premiumEndTime.setTime(
                    premiumEndTime.getTime() + subscriptionDurationMs
                  );

                  await this.db.collection('users').updateOne(
                    { userId: user.userId },
                    {
                      $set: {
                        isPremium: true,
                        premiumEndTime: premiumEndTime,
                        likesSentCount: 0,
                      },
                    }
                  );
                  await ctx.reply(
                    `В тебе тепер є преміум на ${promoCode.premiumPeriod} 🥳`
                  );
                  await this.db.collection('promocodes').updateOne(
                    { promocode: userCode },
                    {
                      $push: { usedBy: user.userId },
                      $inc: { amount: -1 },
                    }
                  );
                }
              }
            } else {
              await ctx.reply(
                'Цей промокод вже використали, наступого разу пощастить більше 🤗'
              );
            }
          } else {
            await ctx.reply('Ти вже використав цей промокод');
          }
        } else {
          await ctx.reply(
            'Щоб користуватись промокодами спочатку треба створити акаунт',
            Markup.keyboard([['👤 Створити профіль']])
              .oneTime()
              .resize()
          );
        }
      } else {
        await ctx.reply(
          'Такого прокмокода не існує, перевір написання і спробуй ще раз'
        );
      }
    });
    promocode.on('message', async (ctx) => {
      await ctx.reply(
        'Якщо маєш промокод введи його тут 👇🏻',
        Markup.removeKeyboard()
      );
    });
    return promocode;
  }

  premiumSettingsScene(): Scenes.BaseScene<MySceneContext> {
    const premiumSettings = new Scenes.BaseScene<MySceneContext>(
      'premiumSettings'
    );
    premiumSettings.enter(async (ctx) => {
      if (ctx.session.userForm.isPremium) {
        const labelText = ctx.session.userForm.showPremiumLabel
          ? '⭐️ — Сховати'
          : '⭐️ — Показати';
        const likesText = ctx.session.userForm.showLikesCount
          ? '❤️ — Сховати'
          : '❤️ — Показати';
        await ctx.reply(
          `${labelText} надпис ⭐️ *Premium Crush* в профілі\n${likesText} статистику під профілем\n<Вставити смайл> — Переглянути свою статистику (ще не створено)`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [['⭐️', '❤️']],
              resize_keyboard: true,
            },
          }
        );
      }
    });
    premiumSettings.hears('⭐️', async (ctx) => {
      const message = ctx.session.userForm.showPremiumLabel
        ? '✅ Надпис прибрано'
        : '✅ Надпис додано';
      const updateField = ctx.session.userForm.showPremiumLabel
        ? { showPremiumLabel: false }
        : { showPremiumLabel: true };
      await this.db
        .collection('users')
        .updateOne({ userId: ctx.from.id }, { $set: updateField });
      ctx.session.userForm.showPremiumLabel =
        !ctx.session.userForm.showPremiumLabel;
      await ctx.reply(message, Markup.removeKeyboard());
    });
    premiumSettings.hears('❤️', async (ctx) => {
      const message = ctx.session.userForm.showLikesCount
        ? '✅ Кількість лайків прибрано'
        : '✅ Кількість лайків додано';
      const updateField = ctx.session.userForm.showLikesCount
        ? { showLikesCount: false }
        : { showLikesCount: true };
      await this.db
        .collection('users')
        .updateOne({ userId: ctx.from.id }, { $set: updateField });
      ctx.session.userForm.showLikesCount =
        !ctx.session.userForm.showLikesCount;
      await ctx.reply(message, Markup.removeKeyboard());
    });
    this.addCommands(premiumSettings);
    premiumSettings.on('message', async (ctx) => {
      if (ctx.session.userForm.isPremium) {
        const labelText = ctx.session.userForm.showPremiumLabel
          ? '⭐️ — Сховати'
          : '⭐️ — Показати';
        const likesText = ctx.session.userForm.showLikesCount
          ? '❤️ — Сховати'
          : '❤️ — Показати';
        await ctx.reply(
          `${labelText} надпис ⭐️ *Premium Crush* в профілі\n${likesText} статистику під профілем\n<Вставити смайл> — Переглянути свою статистику (ще не створено)`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [['⭐️', '❤️']],
              resize_keyboard: true,
            },
          }
        );
      }
    });
    return premiumSettings;
  }

  moderateScene(): Scenes.BaseScene<MySceneContext> {
    const moderate = new Scenes.BaseScene<MySceneContext>('moderate');
    let currentIndex = 0;
    let reportedUsers: UserForm[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let complaints: any[] = [];
    moderate.enter(async (ctx) => {
      currentIndex = 0;

      complaints = await this.db.collection('complaints').find().toArray();
      const reportedUserIds = complaints.map((complaint) => complaint.userId);
      reportedUsers = (await this.db
        .collection('users')
        .find({
          userId: { $in: reportedUserIds },
        })
        .toArray()) as unknown as UserForm[];

      if (reportedUsers.length > 0) {
        await ctx.reply(`Кількість порушників — *${reportedUsers.length}*`, {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [['Забанити', 'Не винний']],
            resize_keyboard: true,
          },
        });
        const reportedUser = reportedUsers[currentIndex];
        const matchingComplaint = complaints.find(
          (complaint) => complaint.userId === reportedUser.userId
        );
        const complaintsNum = matchingComplaint
          ? matchingComplaint.complaintsNum
          : 0;
        await this.sendReportedProfile(
          ctx,
          reportedUser,
          complaintsNum,
          matchingComplaint.descriptions
        );
      } else {
        await ctx.reply('Нових скарг немає', Markup.removeKeyboard());
      }
    });
    moderate.hears(['Забанити', 'Не винний'], async (ctx) => {
      if (currentIndex >= reportedUsers.length) {
        await ctx.reply('Порушники закінчились', Markup.removeKeyboard());
        return;
      }

      const reportedUser = reportedUsers[currentIndex];
      const action = ctx.match?.[0] || '';

      if (action === 'Забанити') {
        const banData = await this.db
          .collection('bans')
          .findOne({ userId: reportedUser.userId });
        const banCount = banData ? banData.banCount : 0;
        const banDuration =
          banCount === 0
            ? FIRST_BAN_TIME
            : banCount === 1
            ? SECOND_BAN_TIME
            : PERMANENT_BAN_TIME;
        const banExpirationDate = new Date(Date.now() + banDuration);
        await this.db.collection('bans').updateOne(
          { userId: reportedUser.userId },
          {
            $set: {
              banExpirationDate,
              banCount: banCount + 1,
            },
          },
          { upsert: true }
        );
      }

      currentIndex++;

      await this.db
        .collection('complaints')
        .deleteOne({ userId: reportedUser.userId });
      if (reportedUsers[currentIndex]) {
        const reportedUser = reportedUsers[currentIndex];
        const matchingComplaint = complaints.find(
          (complaint) => complaint.userId === reportedUser.userId
        );
        const complaintsNum = matchingComplaint
          ? matchingComplaint.complaintsNum
          : 0;
        await this.sendReportedProfile(
          ctx,
          reportedUsers[currentIndex],
          complaintsNum,
          matchingComplaint.descriptions
        );
      } else {
        await ctx.reply('Порушники закінчились', Markup.removeKeyboard());
      }
    });
    this.addCommands(moderate);

    return moderate;
  }

  showPremiumBenefitsScene(): Scenes.BaseScene<MySceneContext> {
    const premiumBenefits = new Scenes.BaseScene<MySceneContext>(
      'premiumBenefits'
    );
    premiumBenefits.enter(async (ctx) => {
      await ctx.reply(
        `Тут мають бути список переваг преміум підписки`,
        Markup.keyboard([['Купити преміум'], ['🔙 Назад']])
          .oneTime()
          .resize()
      );
    });
    premiumBenefits.hears('Купити преміум', async (ctx) => {
      await ctx.scene.enter('premiumPeriod');
    });
    premiumBenefits.hears('🔙 Назад', async (ctx) => {
      await ctx.scene.leave();
    });
    this.addCommands(premiumBenefits);
    premiumBenefits.on('message', async (ctx) => {
      await ctx.reply(
        `Ти можеш або купити преміум або повернутись назад 👇🏻`,
        Markup.keyboard([['Купити преміум'], ['🔙 Назад']])
          .oneTime()
          .resize()
      );
    });
    return premiumBenefits;
  }

  choosePremiumPeriodScene(): Scenes.BaseScene<MySceneContext> {
    const premiumPeriod = new Scenes.BaseScene<MySceneContext>('premiumPeriod');
    premiumPeriod.enter(async (ctx) => {
      const replyMarkup = Markup.keyboard([
        ['1 місяць', '6 місяців', '1 рік'],
        ['🔙 Назад'],
      ])
        .oneTime()
        .resize();

      await ctx.reply(
        `ЗМІНИТИ ЦЕЙ ТЕКСТ\n📅 Який період вас цікавить? Доступні такі пропозиції:\n✦ 1 місяць - 100 гривень\n✦ 6 місяців - 450 гривень (75грн/місяць) замість 600\n✦ 1 рік - 600 гривень (50грн/місяць) замість 1200\n💶 Оплата відбувається разово, після чого преміум автоматично активується.`,
        replyMarkup
      );
    });
    this.addCommands(premiumPeriod);

    premiumPeriod.hears(['1 місяць', '6 місяців', '1 рік'], async (ctx) => {
      const userId = ctx.from!.id;
      const user = await this.getUserFormDataFromDatabase(userId);
      if (!ctx.session.userForm) {
        ctx.session.userForm = new UserFormModel({});
      }
      Object.assign(ctx.session.userForm, user);
      if (user && user.isPremium) {
        await ctx.reply('Ти вже маєш преміум підписку');
        return;
      }

      const subscriptionInfo = this.getSubscriptionInfo(ctx.message.text);
      if (subscriptionInfo) {
        const subscriptionPeriodUa = this.translateSubPeriodToUa(
          subscriptionInfo.period
        );
        const orderReference = this.generateOrderReference(
          userId,
          subscriptionInfo.period
        );
        const paymentRequest = this.createPaymentRequest(
          orderReference,
          subscriptionPeriodUa
        );
        try {
          const response = await axios.post(
            'https://api.wayforpay.com/api',
            paymentRequest
          );
          if (response.data.reason === 'Ok') {
            const invoiceUrl = response.data.invoiceUrl;
            await ctx.reply(
              `Купити підписку на ${subscriptionPeriodUa} за ${subscriptionInfo.price} гривень`,
              Markup.inlineKeyboard([
                Markup.button.url('Купити підписку', invoiceUrl),
              ])
            );
          }
        } catch (error) {
          console.error('WayForPay Error:', error);
        }
      }
    });

    premiumPeriod.hears('🔙 Назад', async (ctx) => {
      await ctx.scene.leave();
    });

    return premiumPeriod;
  }

  getSubscriptionInfo(
    periodOption: string
  ): { period: string; price: number } | null {
    const subscriptionInfoMap: Record<
      string,
      { period: string; price: number }
    > = {
      '1 місяць': { period: '1 month', price: 100 },
      '6 місяців': { period: '6 months', price: 450 },
      '1 рік': { period: '1 year', price: 600 },
    };
    return subscriptionInfoMap[periodOption] || null;
  }

  translateSubPeriodToUa(period: string): string {
    const subscriptionInfoMap: { [key: string]: string } = {
      '1 month': '1 місяць',
      '6 months': '6 місяців',
      '1 year': '1 рік',
    };
    return subscriptionInfoMap[period];
  }

  generateOrderReference(userId: number, subscriptionPeriod: string): string {
    return `ORDER_${Date.now()}_${userId}_${subscriptionPeriod}`;
  }

  createPaymentRequest(orderRef: string, period: string) {
    const merchantAccount = 't_me_bbcec';
    const orderReference = orderRef;
    const orderDate = Math.floor(new Date().getTime() / 1000);
    const currency = 'UAH';
    const serviceUrl = this.configService.get('SERVICE_URL');
    const merchantDomainName = this.configService.get('MERCHANT_DOMAIN_NAME');
    const merchantSecretKey = this.configService.get('MERCHANT_SECRET_KEY');
    const productName = [`Преміум підписка на Crush. Тривалість — ${period}`];
    const productCount = [1];
    const productPrice = [1];
    const orderTimeout = 49000;
    const amount = productPrice.reduce((total, price, index) => {
      return total + price * productCount[index];
    }, 0);
    const merchantAuthType = 'SimpleSignature';
    const stringToSign = `${merchantAccount};${merchantDomainName};${orderReference};${orderDate};${amount};${currency};${productName};${productCount};${productPrice}`;

    const hmac = crypto.createHmac('md5', merchantSecretKey);
    hmac.update(stringToSign, 'utf-8');
    const merchantSignature = hmac.digest('hex');

    const paymentRequest = {
      transactionType: 'CREATE_INVOICE',
      merchantAccount,
      merchantAuthType,
      merchantDomainName,
      merchantSignature,
      apiVersion: 2,
      language: 'ua',
      serviceUrl,
      orderReference,
      orderDate,
      amount,
      currency,
      orderTimeout,
      productName,
      productPrice,
      productCount,
      paymentSystems:
        'card;googlePay;applePay;privat24;visaCheckout;masterPass',
    };
    return paymentRequest;
  }

  donateScene(): Scenes.BaseScene<MySceneContext> {
    const donate = new Scenes.BaseScene<MySceneContext>('donate');
    donate.enter(async (ctx) => {
      await ctx.reply(
        `Щоб розвивати наш бот та залучати більше користувачів, нам потрібно багато кави та енергетиків 🫠
          
Ваші внески сприятимуть довшій життєдіяльності як бота, так і його розробників )`,
        Markup.inlineKeyboard([
          Markup.button.url(
            '🫶🏻 Зробити внесок',
            'https://send.monobank.ua/jar/9dL7twbPY8'
          ),
        ])
      );
    });
    this.addCommands(donate);
    donate.on('message', async (ctx) => {
      await ctx.reply(
        `Щоб розвивати наш бот та залучати більше користувачів, нам потрібно багато кави та енергетиків 🫠
          
Ваші внески сприятимуть довшій життєдіяльності як бота, так і його розробників )`,
        Markup.inlineKeyboard([
          Markup.button.url(
            '🫶🏻 Зробити внесок',
            'https://send.monobank.ua/jar/9dL7twbPY8'
          ),
        ])
      );
    });
    return donate;
  }
  helpScene(): Scenes.BaseScene<MySceneContext> {
    const help = new Scenes.BaseScene<MySceneContext>('help');
    help.enter(async (ctx) => {
      await ctx.reply(
        `🦸‍♀️ Маєш питання або пропозиції?
      
Пиши нам сюди [Олексій](tg://user?id=546195130)`,
        { parse_mode: 'Markdown' }
      );
    });
    this.addCommands(help);
    help.on('message', async (ctx) => {
      await ctx.reply(
        `🦸‍♀️ Маєш питання або пропозиції?
      
Пиши нам сюди [Олексій](tg://user?id=546195130)`,
        { parse_mode: 'Markdown' }
      );
    });
    return help;
  }
  async sendReportedProfile(
    ctx: MySceneContext,
    reportedUser: UserForm,
    complaintsNum: number,
    descriptions: string[]
  ) {
    const banData = await this.db
      .collection('bans')
      .findOne({ userId: reportedUser.userId });
    const complaintsList = descriptions
      .map((complaint, index) => `*${index + 1})* ${complaint}`)
      .join('\n');
    const message = `На цього користувача надійшла скарга:
*Кількість скарг:* ${complaintsNum}
*Кількість банів:* ${banData ? banData.banCount : 0}
*Ім'я:* ${reportedUser.username}
*Вік:* ${reportedUser.age}
*Місто:* ${reportedUser.location}
*Про себе:* ${reportedUser.about?.content}
 
*Причини скарг:*
${complaintsList}`;
    const mediaGroup: MediaGroup = reportedUser.mediaIds.map(
      (mediaObj: { type: string; id: string }, index: number) => ({
        type: mediaObj.type as 'document',
        media: mediaObj.id,
        caption: index === 0 ? message : undefined,
        parse_mode: index === 0 ? 'Markdown' : undefined,
      })
    );
    await ctx.replyWithMediaGroup(mediaGroup);
  }
  addCommands(scene: Scenes.BaseScene<MySceneContext>) {
    scene.command('start', async (ctx) => {
      await ctx.reply(`Вітаємо в ком'юніті Crush! 👋🏻

💝 Crush — український бот знайомств, який наповнить твоє життя приємними моментами. Він допоможе тобі знайти ідеального компаньйона для будь-якої події або просто для приємної прогулянки в парку. А можливо, саме тут ти знайдеш свою кохану людину, нового друга або подругу для незабутніх спільних моментів!
      
Команда crush’а міцно обійняла тебе🫂
      `);
      await ctx.reply('⬇️⁣');
    });
    scene.command('events', async (ctx) => {
      await ctx.scene.enter('eventChoose');
    });
    scene.command('people', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    scene.command('help', async (ctx) => {
      await ctx.scene.enter('help');
    });
    scene.command('profile', async (ctx) => {
      await ctx.scene.enter('userform');
    });
    scene.command('donate', async (ctx) => {
      await ctx.scene.enter('donate');
    });
    scene.command('premium', async (ctx) => {
      await ctx.scene.enter('premiumBenefits');
    });
    scene.command('code', async (ctx) => {
      await ctx.scene.enter('promocode');
    });
    scene.hears('🗄 Перейти у архів', async (ctx) => {
      await ctx.scene.enter('likeArchive');
    });
    scene.hears('👫 Звичайний пошук', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    scene.hears('🍾 Події', async (ctx) => {
      await ctx.scene.enter('eventChoose');
    });
    scene.command('premiumTest', async (ctx) => {
      // TEST FUNC DELETE IN PROD!!!!!
      const subscriptionDurationMs = SUBSCRIPTION_DURATION_TEST;
      const premiumEndTime = new Date();
      premiumEndTime.setTime(premiumEndTime.getTime() + subscriptionDurationMs);

      await this.db.collection('users').updateOne(
        { userId: +this.configService.get('TG_MODERATOR_ID') },
        {
          $set: {
            isPremium: true,
            premiumEndTime: premiumEndTime,
            likesSentCount: 0,
          },
        }
      );
      ctx.telegram.sendMessage(
        this.configService.get('TG_MODERATOR_ID'),
        'В тебе тепер є преміум'
      );
    });
  }

  async saveUserFormToDatabase(userForm: UserForm) {
    try {
      const userFormData = new UserFormModel<UserForm>(userForm);
      const user = await this.db
        .collection('users')
        .findOne({ userId: userForm.userId });
      if (user) {
        await this.db.collection('users').updateOne(
          { userId: userForm.userId },
          {
            $set: {
              // Cannot just pass an userFormdData obj as it causes error for some reason
              userId: userForm.userId,
              username: userForm.username,
              gender: userForm.gender,
              lookingFor: userForm.lookingFor,
              age: userForm.age,
              about: userForm.about,
              socialLinks: userForm.socialLinks,
              coordinates: userForm.coordinates,
              actualLocation: userForm.actualLocation,
              location: userForm.location,
              mediaIds: userForm.mediaIds,
              likesSentCount: userForm.likesSentCount,
              isActive: userForm.isActive,
              isPremium: userForm.isPremium,
              premiumEndTime: userForm.premiumEndTime,
              showPremiumLabel: userForm.showPremiumLabel,
              lastActive: userForm.lastActive,
              likesCount: userForm.likesCount,
              dislikesCount: userForm.dislikesCount,
              registrationDate: userForm.registrationDate,
            },
          }
        );
      } else {
        const currentDate = new Date();
        const year = currentDate.getFullYear();
        const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
        const day = currentDate.getDate().toString().padStart(2, '0');
        const formattedDate = `${day}.${month}.${year}`;
        userFormData.registrationDate = formattedDate;
        userFormData.showPremiumLabel = true;
        userFormData.showLikesCount = true;
        userFormData.likesCount = 0;
        userFormData.dislikesCount = 0;
        await this.db.collection('users').insertOne(userFormData);
      }
    } catch (error) {
      console.error('Error saving UserForm data:', error);
    }
  }
  async saveEventToDatabase(event: Event) {
    try {
      const eventData = new EventModel<Event>(event);

      await this.db.collection('events').insertOne(eventData);
    } catch (error) {
      console.error('Error saving eventData data:', error);
    }
  }
  async getUserFormDataFromDatabase(userId: number) {
    try {
      if (!this.isConnectionOpened) {
        await this.client.connect();
        console.log('connection opened');
      }
      const userForm = await this.db.collection('users').findOne({ userId });
      return userForm;
    } catch (error) {
      console.error('Error getting userForm data from db', error);
    }
  }
  async registerUserLastActivity(userId: number) {
    await this.db.collection('users').updateOne(
      { userId },
      {
        $set: {
          lastActive: new Date().toLocaleString(),
        },
      }
    );
  }
  async getEventsFromDatabase(userId: number, userGender: string, userLocation: string) {
    try {
      const regex = new RegExp(userLocation, 'i');
      const events = await this.db
        .collection('events')
        .find({
          userId: { $ne: userId },
          location: { $regex: regex },
          lookingFor: { $in: [userGender, 'both'] },
        })
        .toArray();
      return events;
    } catch (error) {
      console.error('Error getting events data from db', error);
    }
  }

  async getBotEventsListFromDatabase(location: string) {
    try {
      const regex = new RegExp(location, 'i');
      const events = await this.db
        .collection('bot_events')
        .find({ location: { $regex: regex } })
        .toArray();
      return events;
    } catch (error) {
      console.error('Error getting events data from db', error);
    }
  }

  async loadProfilesWithoutLocationSpecified(ctx: MySceneContext) {
    const viewQuery = [
      {
        $match: {
          viewerUserId: ctx.session.userForm.userId,
        },
      },
      {
        $group: {
          _id: null,
          viewedUserIds: { $addToSet: '$viewedUserId' },
        },
      },
    ];
    const aggregationResult = await this.db
      .collection('viewed_profiles')
      .aggregate(viewQuery)
      .toArray();
    let distinctViewedUserIds = [];
    if (aggregationResult.length > 0) {
      distinctViewedUserIds = aggregationResult[0].viewedUserIds;
    }
    const noLocationPipeline = [
      {
        $match: {
          $and: [
            {
              userId: { $ne: ctx.session.userForm.userId },
              gender:
                ctx.session.userForm.lookingFor === 'both'
                  ? { $in: ['male', 'female'] }
                  : ctx.session.userForm.lookingFor,
              lookingFor: { $in: [ctx.session.userForm.gender, 'both'] },
              isActive: true,
            },
            {
              userId: { $nin: distinctViewedUserIds },
            },
          ],
        },
      },
      {
        $addFields: {
          randomWeight: { $rand: {} },
        },
      },
      {
        $addFields: {
          isPremiumWeight: {
            $cond: {
              if: { $eq: ['$isPremium', true] },
              then: { $add: ['$randomWeight', 0.5] },
              else: '$randomWeight',
            },
          },
        },
      },
      {
        $sort: { isPremiumWeight: -1 },
      },
    ];
    return (await this.db
      .collection('users')
      .aggregate(noLocationPipeline)
      .toArray()) as unknown as UserForm[];
  }

  async getUserEventsFromDatabase(userId: number) {
    try {
      const events = await this.db
        .collection('events')
        .find({
          userId: userId,
        })
        .toArray();
      return events;
    } catch (error) {
      console.error('Error getting events data from db', error);
    }
  }
  async getEventFromDatabase(userId: number, eventId: number) {
    try {
      const event = await this.db.collection('events').findOne({
        userId: userId,
        eventId: eventId,
      });
      return event;
    } catch (error) {
      console.error('Error getting events data from db', error);
    }
  }

  async getUserCityFromCoordinates(latitude: number, longitude: number) {
    const apiUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&language=uk-UA&key=${this.API_KEY}`;
    try {
      const response = await axios.get(apiUrl);
      if (response.data.results.length > 0) {
        const addressComponents = response.data.results[0].address_components;
        const cityComponent = addressComponents.find(
          (component: { types: string | string[] }) =>
            component.types.includes('locality')
        );

        if (cityComponent) {
          const cityName = cityComponent.long_name;
          return cityName;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Error fetching user city:', error.message);
    }
  }
  async sendUserDetails(
    userArrayFromDB: UserForm[],
    currentIndex: number,
    ctx: MySceneContext
  ) {
    const user = userArrayFromDB[currentIndex];
    if (user) {
      let caption =
        (user.isPremium && user.showPremiumLabel
          ? `⭐️ *Premium Crush*\n\n`
          : '') +
        `*Ім'я:* ${user.username}
*Вік:* ${user.age}
*Місто:* ${user.location}`;
      if (user.about?.type === 'text') {
        caption = caption + `\n\n*Про себе:* ${user.about.content}`;
      }
      if (ctx.session.userForm.coordinates && user.coordinates) {
        let unit = 'км';
        let distance = this.calculateDistance(
          ctx.session.userForm.coordinates.latitude,
          ctx.session.userForm.coordinates.longitude,
          user.coordinates.latitude,
          user.coordinates.longitude
        );
        if (distance < 1) {
          distance = Math.round(distance * 10) * 100;
          unit = 'м';
        } else {
          distance = Math.round(distance);
        }
        caption = caption + `\n*${distance}${unit}* від вас`;
      }
      if (ctx.session.userForm.isPremium) {
        caption =
          caption +
          (!user.isPremium || (user.isPremium && user.showLikesCount)
            ? `\n\n*❤️ — ${user.likesCount ?? 0}*`
            : '');
      }
      if (user.socialLinks && user.socialLinks.length > 0) {
        let message = '';
        for (const link of user.socialLinks) {
          message = message ? message + ' | ' : message + '';
          message = message + link;
        }
        caption = caption + '\n\n' + message;
      }
      const mediaGroup: MediaGroup = user.mediaIds.map(
        (mediaObj: { type: string; id: string }, index: number) => ({
          type: mediaObj.type as 'document',
          media: mediaObj.id,
          caption: index === 0 ? caption : undefined,
          parse_mode: index === 0 ? 'Markdown' : undefined,
        })
      );
      await ctx.replyWithMediaGroup(mediaGroup);
      if (user.about?.type === 'voice') {
        await ctx.replyWithVoice(user.about.content, {
          caption: '*Про себе:*',
          parse_mode: 'Markdown',
        });
      }
      return false;
    } else {
      return true;
    }
  }

  showUserProfile(
    userForm: UserForm,
    currentUser: UserForm,
    likeMessage?: { type: string; content: string }
  ): MediaGroup {
    let caption =
      (userForm.isPremium && userForm.showPremiumLabel
        ? `⭐️ *Premium Crush*\n\n`
        : '') +
      `*Ім'я:* ${userForm.username}
*Вік:* ${userForm.age}
*Місто:* ${userForm.location}`;
    if (userForm.about?.type === 'text') {
      caption = caption + `\n\n*Про себе:* ${userForm.about.content}`;
    }
    if (currentUser.coordinates && userForm.coordinates) {
      let unit = 'км';
      let distance = this.calculateDistance(
        currentUser.coordinates.latitude,
        currentUser.coordinates.longitude,
        userForm.coordinates.latitude,
        userForm.coordinates.longitude
      );
      if (distance < 1) {
        distance = Math.round(distance * 10) * 100;
        unit = 'м';
      } else {
        distance = Math.round(distance);
      }
      caption = caption + `\n*${distance}${unit}* від вас`;
    }
    if (currentUser.isPremium) {
      caption =
        caption +
        (!userForm.isPremium || (userForm.isPremium && userForm.showLikesCount)
          ? `\n\n*❤️ — ${userForm.likesCount ?? 0}*`
          : '');
    }
    if (likeMessage && likeMessage.type === 'text') {
      caption =
        caption + '\n' + '*💌 Повідомлення від користувача: *' + likeMessage.content;
    }
    if (userForm.socialLinks && userForm.socialLinks.length > 0) {
      let message = '';
      for (const link of userForm.socialLinks) {
        message = message ? message + ' | ' : message + '';
        message = message + link;
      }
      caption = caption + '\n\n' + message;
    }
    const mediaGroup: MediaGroup = userForm.mediaIds.map(
      (mediaObj: { type: string; id: string }, index: number) => ({
        type: mediaObj.type as 'document',
        media: mediaObj.id,
        caption: index === 0 ? caption : undefined,
        parse_mode: index === 0 ? 'Markdown' : undefined,
      })
    );
    return mediaGroup;
  }
  async showEvent(events: Event[], currentIndex: number, ctx: MySceneContext) {
    const event = events[currentIndex];
    if (event) {
      const eventInitiatorId = event.userId.toString();
      const message = `*Назва події:* ${event.eventName.replace(
        /([_*[\]()~`>#+=|{}.!-])/g,
        '\\$1'
      )}\n*Дата та час події:* ${event.date.replace(
        /([_*[\]()~`>#+=|{}.!-])/g,
        '\\$1'
      )}\n*Місто:* ${event.location?.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1')}`;
      const inlineKeyboardMarkup = Markup.inlineKeyboard([
        Markup.button.callback(
          '✅ Хочу піти',
          `inviteToEvent:${eventInitiatorId}:${event.eventId}`
        ),
        Markup.button.callback('❌ Наступна подія', `nextEvent`),
      ]);
  
      if (event.about) {
        await ctx.replyWithMarkdownV2(
          `${message}\n*Деталі:* ${event.about.replace(
            /([_*[\]()~`>#+=|{}.!-])/g,
            '\\$1'
          )}`,
          inlineKeyboardMarkup
        );
      } else {
        await ctx.replyWithMarkdownV2(message, inlineKeyboardMarkup);
      }
    } else {
      await ctx.reply(
        'Подій, які підходять під твої запити, більше немає, можеш створити нову',
        Markup.removeKeyboard()
      );
    }
  }
  

  async showBotEvent(
    events: Event[],
    currentIndex: number,
    ctx: MySceneContext
  ) {
    const event = events[currentIndex];
    if (event) {
      let caption = `*Назва події:* ${event.eventName}\n*Дата та час події:* ${event.date}\n*Місто:* ${event.location}`;
      if (event.about) {
        caption = `${caption}\n*Деталі: * ${event.about}`;
      }
      if (event.mediaIds && event.mediaIds.length > 0) {
        const mediaGroup: MediaGroup = event.mediaIds.map(
          (mediaObj: { type: string; id: string }, index: number) => ({
            type: mediaObj.type as 'document',
            media: mediaObj.id,
            caption: index === 0 ? caption : undefined,
            parse_mode: index === 0 ? 'Markdown' : undefined,
          })
        );
        await ctx.telegram.sendMediaGroup(ctx.from!.id, mediaGroup);
        return;
      }
      await ctx.reply(caption, {
        parse_mode: 'Markdown',
      });
      return;
    } else {
      await ctx.reply(
        'Подій, які підходять під твої запити, більше немає, можеш створити нову',
        Markup.removeKeyboard()
      );
    }
  }

  async showUserEvent(
    events: Event[],
    currentIndex: number,
    ctx: MySceneContext
  ) {
    const event = events[currentIndex];
    if (event) {
      const message = `*Назва події:* ${event.eventName.replace(
        /([_*[\]()~`>#+=|{}.!-])/g,
        '\\$1'
      )}\n*Дата та час події:* ${event.date.replace(
        /([_*[\]()~`>#+=|{}.!-])/g,
        '\\$1'
      )}\n*Місто:* ${event.location.replace(
        /([_*[\]()~`>#+=|{}.!-])/g,
        '\\$1'
      )}`;
      const inlineKeyboardMarkup = Markup.inlineKeyboard([
        Markup.button.callback(
          '❌ Видалити подію',
          `deleteEvent:${event.userId}`
        ),
      ]);
  
      if (event.about) {
        await ctx.replyWithMarkdownV2(
          `${message}\n*Деталі:* ${event.about}`,
          inlineKeyboardMarkup
        );
      } else {
        await ctx.replyWithMarkdownV2(message, inlineKeyboardMarkup);
      }
    } else {
      await ctx.reply(
        'Подій більше немає, можеш створити нову',
        Markup.removeKeyboard()
      );
    }
  }
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const radLat1 = (Math.PI * lat1) / 180;
    const radLon1 = (Math.PI * lon1) / 180;
    const radLat2 = (Math.PI * lat2) / 180;
    const radLon2 = (Math.PI * lon2) / 180;

    const earthRadius = 6371;

    const dLat = radLat2 - radLat1;
    const dLon = radLon2 - radLon1;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(radLat1) *
        Math.cos(radLat2) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = earthRadius * c;

    return distance;
  }
}
