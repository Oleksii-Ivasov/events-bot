import { Markup, Scenes } from 'telegraf';
import { MySceneContext } from '../models/context.interface';
import { UserForm } from '../models/userForm.interface';
import { UserFormModel } from '../models/userForm.schema';
import { MongoClient } from 'mongodb';
import axios from 'axios';
import { IConfigService } from '../models/config.interface';
import { Event } from '../models/event.interface';
import { EventModel } from '../models/event.schema';
import Fuse from 'fuse.js';
import fs from 'fs';
import crypto from 'crypto';
import cron from 'node-cron';
import { MediaGroup } from 'telegraf/typings/telegram-types';

const MAX_LIKES_LIMIT = 2;

export class SceneGenerator {
  constructor(
    private readonly client: MongoClient,
    private configService: IConfigService
  ) {
    cron.schedule('*/59 * * * *', async () => {
      // every 59 minutes check
      const currentDate = new Date();
      const inactiveThreshold = 60 * 60 * 2 * 1000; // 2 hours
      await client.connect();
      const db = client.db('cluster0');
      const users = await db.collection('users').find().toArray();

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
      const usersToResetLikes = await db
        .collection('users')
        .find({
          isPremium: false,
          likesSentCount: { $gt: 0 },
        })
        .toArray();
      for (const user of usersToResetLikes) {
        await db
          .collection('users')
          .updateOne({ userId: user.userId }, { $set: { likesSentCount: 0 } });
        if (this.userForm.userId === user.userId) {
          this.userForm.likesSentCount = 0;
        }
      }
      const usersToCheck = await db
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
        await db.collection('users').updateOne(
          { userId: user.userId },
          {
            $set: {
              isPremium: false,
              premiumEndTime: null,
            },
          }
        );
      }
    });
  }
  API_KEY = this.configService.get('API_KEY');
  userForm = new UserFormModel({
    userId: NaN,
    username: '',
    gender: 'male',
    lookingFor: 'both',
    age: NaN,
    about: '',
    actualLocation: {
      longitude: NaN,
      latitude: NaN,
    },
    location: '',
    mediaIds: [],
    likesSentCount: 0,
    isActive: true,
    isPremium: false,
    premiumEndTime: null,
    showPremiumLable: true,
    lastActive: new Date().toLocaleString(),
  });
  event: Event = {
    userId: NaN,
    eventId: NaN,
    eventName: '',
    date: '',
    about: undefined,
    lookingFor: '',
    //ageRange: '',
  };

  greetingScene(): Scenes.BaseScene<MySceneContext> {
    const greeting = new Scenes.BaseScene<MySceneContext>('greeting');
    greeting.enter(async (ctx) => {
      const user = await this.getUserFormDataFromDatabase(ctx.from!.id);
      if (!user) {
        await ctx.reply(
          '⬇️⁣',
          Markup.keyboard([['Створити профіль']]).resize()
        );
      } else {
        await ctx.reply('⬇️⁣', Markup.removeKeyboard());
        await this.registerUserLastActivity(user.userId);
      }
    });
    greeting.command('moderate', async (ctx) => {
      await ctx.scene.enter('moderate');
    });
    greeting.hears('Створити профіль', async (ctx) => {
      await ctx.scene.enter('name');
    });
    greeting.hears('🍾 Події', async (ctx) => {
      await ctx.scene.enter('eventList');
    });
    this.addCommands(greeting);
    greeting.on('message', async (ctx) => {
      await ctx.reply('⬇️ Обирай дії в меню');
    });
    return greeting;
  }

  nameScene(): Scenes.BaseScene<MySceneContext> {
    const name = new Scenes.BaseScene<MySceneContext>('name');
    name.enter(async (ctx) => {
      await ctx.reply('Як до тебе звертатись?', Markup.removeKeyboard());
    });
    this.addCommands(name);
    name.on('text', async (ctx) => {
      this.userForm.userId = ctx.message.from.id;
      this.userForm.username = ctx.message.text;
      if (this.userForm.username) {
        await ctx.scene.enter('age');
      }
    });
    name.on('message', async (ctx) => {
      await ctx.reply("Давай краще ім'я");
      ctx.scene.reenter();
    });

    return name;
  }
  ageScene(): Scenes.BaseScene<MySceneContext> {
    const age = new Scenes.BaseScene<MySceneContext>('age');
    age.enter(async (ctx) => {
      await ctx.reply('Скільки тобі років?');
    });
    this.addCommands(age);
    age.on('text', async (ctx) => {
      this.userForm.age = Number(ctx.message.text);
      if (this.userForm.age && this.userForm.age > 0) {
        await ctx.scene.enter('location');
      } else if (!this.userForm.age) {
        await ctx.reply('Вкажи вік цифрами');
      } else if (this.userForm.age <= 0) {
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
      await ctx.reply(
        'Давай створимо твою анкету. Якої ти статі?',
        Markup.keyboard([['Хлопець', 'Дівчина']]).resize()
      );
    });
    this.addCommands(gender);
    gender.hears('Хлопець', async (ctx) => {
      this.userForm.gender = 'male';
      await ctx.scene.enter('lookingFor');
    });
    gender.hears('Дівчина', async (ctx) => {
      this.userForm.gender = 'female';
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
      this.userForm.lookingFor = 'male';
      await ctx.scene.enter('name');
    });
    lookingFor.hears('Дівчата', async (ctx) => {
      this.userForm.lookingFor = 'female';
      await ctx.scene.enter('name');
    });
    lookingFor.hears('Неважливо', async (ctx) => {
      this.userForm.lookingFor = 'both';
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
      await ctx.reply(
        'Напиши пару слів про себе: що полюбляєш, кого шукаєш',
        Markup.keyboard(['Пропустити']).resize()
      );
    });
    this.addCommands(about);
    about.hears('Пропустити', async (ctx) => {
      await ctx.scene.enter('userform');
    });
    about.on('text', async (ctx) => {
      const userAbout = ctx.message.text;
      if (userAbout.length > 140) {
        await ctx.reply('Занадто велике повідомлення, зроби трохи меншим');
      } else {
        this.userForm.about = userAbout;
        ctx.scene.enter('photo');
      }
    });
    about.on('message', async (ctx) => {
      await ctx.reply('Будь-ласка, напиши про себе');
    });
    return about;
  }
  locationScene(): Scenes.BaseScene<MySceneContext> {
    const location = new Scenes.BaseScene<MySceneContext>('location');
    location.enter(async (ctx) => {
      await ctx.reply(
        'З якого ти міста?',
        Markup.keyboard([
          Markup.button.locationRequest('Відправити місцезнаходження'),
        ]).resize()
      );
    });
    this.addCommands(location);
    location.on('location', async (ctx) => {
      try {
        const { latitude, longitude } = ctx.message.location;
        const userLocationName = await this.getUserCityFromCoordinates(
          latitude,
          longitude
        );
        this.userForm.actualLocation = userLocationName.toLowerCase();
        this.userForm.location = userLocationName;
        await ctx.scene.enter('about');
      } catch (error) {
        ctx.reply('Упс... Відбулася помилка');
      }
    });
    location.on('text', async (ctx) => {
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

      if (matchingCities.length > 0) {
        this.userForm.actualLocation =
          matchingCities[0].item.original.toLowerCase();
        this.userForm.location = ctx.message.text;
        await ctx.scene.enter('about');
      } else {
        this.userForm.location = ctx.message.text;
        this.userForm.actualLocation = ctx.message.text.toLowerCase();
        await ctx.scene.enter('about');
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

  private maxPhotoCount: number = 1;
  private isUploaded = false;
  photoScene(): Scenes.BaseScene<MySceneContext> {
    const photo = new Scenes.BaseScene<MySceneContext>('photo');

    const isMediaLimitReached = () =>
      this.userForm.mediaIds.length >= this.maxPhotoCount;

    const handleMediaUpload = async (
      ctx: MySceneContext,
      mediaType: string,
      mediaId: string
    ) => {
      if (!isMediaLimitReached()) {
        this.userForm.mediaIds.push({ type: mediaType, id: mediaId });
      }
      if (!isMediaLimitReached()) {
        await ctx.reply(
          `Ти завантажив ${this.userForm.mediaIds.length} з ${this.maxPhotoCount} доступних медіа. Можеш зберегти медіа або додати ще`,
          Markup.keyboard([['Це все, зберегти медіа']])
            .oneTime()
            .resize()
        );
      } else if (!this.isUploaded) {
        this.isUploaded = true;
        await this.saveUserFormToDatabase(this.userForm);
        await ctx.scene.enter('userform');
      }
    };
    photo.enter(async (ctx) => {
      this.maxPhotoCount = this.userForm.isPremium ? 3 : 1;
      this.userForm.mediaIds = [];
      this.isUploaded = false;
      const photoPrompt = this.userForm.isPremium
        ? 'Обери свої найкращі фото або відео (тривалістю до 15 секунд) (максимум 3), які будуть бачити інші'
        : 'Обери своє найкраще фото або відео (тривалістю до 15 секунд), яке будуть бачити інші';
      await ctx.reply(photoPrompt, Markup.removeKeyboard());
    });

    this.addCommands(photo);

    photo.on('photo', async (ctx) => {
      const photos = ctx.message.photo;
      photos.sort((a, b) => {
        const resolutionA = a.width * a.height;
        const resolutionB = b.width * b.height;
        return resolutionB - resolutionA;
      });
      handleMediaUpload(ctx, 'photo', photos[0].file_id);
    });

    photo.on('video', async (ctx) => {
      const video = ctx.message.video;
      if (video.duration <= 15) {
        handleMediaUpload(ctx, 'video', video.file_id);
      } else {
        await ctx.reply(
          'Відео занадто довге. Будь-ласка, завантаж відео тривалістю до 15 секунд'
        );
      }
    });
    photo.hears('Це все, зберегти медіа', async (ctx) => {
      this.isUploaded = true;
      await this.saveUserFormToDatabase(this.userForm);
      await ctx.scene.enter('userform');
    });
    photo.hears('👫 Звичайний пошук', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    photo.hears('🍾 Події', async (ctx) => {
      await ctx.scene.enter('eventList');
    });
    photo.on('text', async (ctx) => {
      await ctx.reply(
        'Завантаж, будь-ласка, своє фото або відео',
        Markup.removeKeyboard()
      );
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
          Object.assign(this.userForm, userForm);
          await this.registerUserLastActivity(userForm.userId);
          const mediaGroup = this.showUserProfile(this.userForm);
          await ctx.replyWithMediaGroup(mediaGroup);
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
            const userForm = await this.getUserFormDataFromDatabase(
              ctx.from!.id
            );
            if (userForm) {
              events = await this.getUserEventsFromDatabase(userForm.userId);
              this.userForm.userId = ctx.from!.id;
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
              await ctx.scene.enter('greeting');
            }
            const regex = new RegExp(/^deleteEvent:(.*)$/);
            userFormScene.action(regex, async (ctx) => {
              const userId = +ctx.match[1];
              await this.client.connect();
              const db = this.client.db('cluster0');
              await db.collection('events').deleteOne({ userId: userId });
              await ctx.deleteMessage();
            });
          });
          userFormScene.hears('🗄', async (ctx) => {
            await ctx.scene.enter('likeArchive');
          });
          userFormScene.hears('⭐️', async (ctx) => {
            if (this.userForm.isPremium) {
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
            await this.client.connect();
            const db = this.client.db('cluster0');
            await db
              .collection('users')
              .updateOne(
                { userId: ctx.from.id },
                { $set: { isActive: false } }
              );
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
            await ctx.scene.enter('showPremiumBenefits');
          });
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
        } else {
          await ctx.reply('В тебе ще немає профілю');
          await ctx.scene.enter('greeting');
        }
      }
    });
    this.addCommands(userFormScene);
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
        eventId: NaN,
        eventName: '',
        date: '',
        about: undefined,
        lookingFor: '',
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
        await this.saveEventToDatabase(this.event);
        await ctx.reply(
          `Бінго! Очікуй на свій perfect match та неймовірно проведений час `,
          Markup.removeKeyboard()
        );
        await ctx.scene.enter('greeting');
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

  eventListScene(): Scenes.BaseScene<MySceneContext> {
    const eventList = new Scenes.BaseScene<MySceneContext>('eventList');
    let currentEventIndex = 0;
    //let currentUserIndex = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let events: any;
    eventList.enter(async (ctx) => {
      const userForm = await this.getUserFormDataFromDatabase(ctx.from!.id);
      if (userForm) {
        events = await this.getEventsFromDatabase(
          userForm.userId,
          userForm.gender
        );
        await ctx.reply(`🍾 Розпочинаємо пошук подій...

Сподіваємось, ви чудово проведете час.
        
👀 Нагадаємо, що тут ви можете знайти цікаву для себе подію та піти на неї з тим, хто створив цю подію!`);
        currentEventIndex = 0;
        this.userForm.userId = ctx.from!.id;
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
        await ctx.scene.enter('greeting');
      }
    });

    eventList.action('nextEvent', async (ctx) => {
      currentEventIndex++;
      await this.showEvent(events, currentEventIndex, ctx);
      await ctx.editMessageReplyMarkup(undefined);
    });
    const regex = new RegExp(/^inviteToEvent:(.*)$/);
    eventList.action(regex, async (ctx) => {
      const eventUserId = +ctx.match[1];
      const eventUser = await this.getUserFormDataFromDatabase(eventUserId);
      if (eventUser) {
        const event = await this.getEventFromDatabase(eventUserId);
        if (event) {
          await ctx.editMessageReplyMarkup(undefined);
          const caption =
            `*Ім'я:* ${eventUser.username}
*Вік:* ${eventUser.age}
*Місто:* ${eventUser.location}` +
            (eventUser.about ? `\n\n*Про себе:* ${eventUser.about}` : '');
          await ctx.reply('Ініціатор запрошення на подію 👇🏻');
          await ctx.replyWithPhoto(eventUser.photoId, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [['❤️', '👎']],
              resize_keyboard: true,
            },
          });
          eventList.hears('❤️', async (ctx) => {
            const userForm = await this.getUserFormDataFromDatabase(
              ctx.from.id
            );
            if (userForm) {
              let username = ctx.from?.username;
              if (username) {
                username = '@' + username;
              }
              const userId = ctx.from!.id;
              const userLink = `tg://user?id=${userId}`;
              const mentionMessage =
                username || `[${ctx.from?.first_name}](${userLink})`;
              const userAbout = userForm.about ? `, ${userForm.about}` : '';
              const eventAbout = event.about ? `, ${event.about}` : '';
              await ctx.telegram.sendPhoto(eventUserId, userForm.photoId, {
                caption: `👀Один краш бажає піти з тобою на запропоновану тобою подію:

🧘🏼*Краш:* ${userForm.username}, ${userForm.age}, ${userForm.location}${userAbout}

🎟 *Подія:* ${event.eventName}, ${event.date}${eventAbout}`,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: '❤️',
                        callback_data: `likeEvent:${userId}:${mentionMessage}`,
                      },
                      {
                        text: '👎',
                        callback_data: `dislikeEvent`,
                      },
                    ],
                  ],
                },
              });
              await ctx.reply(
                `Супер! Очікуй на повідомлення від ініціатора події 🥳 Бажаю приємно провести час 👋`,
                Markup.removeKeyboard()
              );
            } else {
              await ctx.reply('Спочатку створи анкету');
              await ctx.scene.enter('greeting');
            }
          });
          eventList.hears('👎', async (ctx) => {
            await ctx.reply('Продовжуємо шукати...');
            currentEventIndex++;
            await this.showEvent(events, currentEventIndex, ctx);
          });
        } else {
          await ctx.reply('Упс... Схоже сталася помилка');
        }
      } else {
        await ctx.reply('Упс... Схоже сталася помилка');
      }

      // Intive to event code
      // currentUserIndex = 0;
      // const userId = ctx.from!.id;
      // const eventName = ctx.match[1];
      // const eventDate = ctx.match[2];
      // try {
      //   const userFormData = await this.getUserFormDataFromDatabase(userId);
      //   if (userFormData) {
      //     Object.assign(this.userForm, userFormData);
      //   }
      //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
      //   const query: any = {
      //     userId: { $ne: userId },
      //     actualLocation: this.userForm.actualLocation,
      //     gender:
      //       this.userForm.lookingFor === 'both'
      //         ? { $in: ['male', 'female'] }
      //         : this.userForm.lookingFor,
      //     lookingFor: { $in: [this.userForm.gender, 'both'] },
      //   };
      //   await this.client.connect();
      //   const db = this.client.db('cluster0');
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
      //           caption: `${this.userForm.username}, ${this.userForm.age}, ${this.userForm.location}, хоче піти з тобою на подію ${eventName} ${eventDate}. Обговори деталі та приємно проведіть цей час 👋`,
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
      // } finally {
      //   await this.client.close();
      // }
    });
    this.addCommands(eventList);
    eventList.on('message', async (ctx) => {
      await ctx.reply('Обери подію на яку бажаєш піти');
    });
    return eventList;
  }
  private reportedUserId: number | undefined = undefined;
  lookForMatchScene(): Scenes.BaseScene<MySceneContext> {
    const lookForMatch = new Scenes.BaseScene<MySceneContext>('lookForMatch');
    let currentUserIndex = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let userMatchForms: any;
    lookForMatch.enter(async (ctx) => {
      const userFormData = await this.getUserFormDataFromDatabase(ctx.from!.id);
      if (userFormData && userFormData.banExpirationDate) {
        await ctx.reply('Ти в бані');
        return;
      }
      currentUserIndex = 0;
      if (userFormData) {
        Object.assign(this.userForm, userFormData);
        await this.registerUserLastActivity(userFormData.userId);
        await ctx.reply(
          `👫 Розпочинаємо звичайний пошук...

Сподіваємось, ти знайдеш свого краша
            
👀 Пам ятайте, що люди в Інтернеті можуть бути не тими, за кого себе видають`,
          Markup.keyboard([['❤️', '👎', 'Скарга']]).resize()
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.client.connect();
        const db = this.client.db('cluster0');
        this.userForm.isActive = true;
        await db
          .collection('users')
          .updateOne({ userId: ctx.from!.id }, { $set: { isActive: true } });
        const viewQuery = [
          {
            $match: {
              viewerUserId: this.userForm.userId,
            },
          },
          {
            $group: {
              _id: null,
              viewedUserIds: { $addToSet: '$viewedUserId' },
            },
          },
        ];

        const aggregationResult = await db
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
                  userId: { $ne: this.userForm.userId },
                  actualLocation: this.userForm.actualLocation,
                  gender:
                    this.userForm.lookingFor === 'both'
                      ? { $in: ['male', 'female'] }
                      : this.userForm.lookingFor,
                  lookingFor: { $in: [this.userForm.gender, 'both'] },
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

        userMatchForms = await db
          .collection('users')
          .aggregate(pipeline)
          .toArray();
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
      } else {
        await ctx.reply(
          'Щоб переглядати профілі інших користувачів, необхіодно створити свій',
          Markup.removeKeyboard()
        );
        await ctx.scene.enter('greeting');
      }
    });
    lookForMatch.hears('❤️', async (ctx) => {
      await this.registerUserLastActivity(this.userForm.userId);
      if (
        !this.userForm.isPremium &&
        this.userForm.likesSentCount >= MAX_LIKES_LIMIT
      ) {
        await ctx.reply(
          'Вибач, але ти досяг ліміту лайків на сьогодні, купи преміум підписку або почекай до завтра'
        );
        return;
      }
      if (!this.userForm.isPremium) {
        this.userForm.likesSentCount++;
        await this.client.connect();
        const db = this.client.db('cluster0');
        await db
          .collection('users')
          .updateOne(
            { userId: this.userForm.userId },
            { $set: { likesSentCount: this.userForm.likesSentCount } }
          );
      }
      currentUserIndex++;
      await this.sendUserDetails(
        userMatchForms as unknown as UserForm[],
        currentUserIndex,
        ctx
      );
      if (currentUserIndex > 0) {
        const previousUser = userMatchForms[currentUserIndex - 1];
        const previousUserId = previousUser.userId;
        try {
          const viewerUserId = this.userForm.userId;
          if (previousUserId) {
            await this.client.connect();
            const db = this.client.db('cluster0');
            await db.collection('viewed_profiles').insertOne({
              viewerUserId: viewerUserId,
              viewedUserId: previousUserId,
              expiryTimestamp: new Date(Date.now() + 10 * 1000),
            });
          }
          let username = ctx.from?.username;
          if (username) {
            username = '@' + username;
          }
          const userId = ctx.from!.id;
          const userLink = `tg://user?id=${userId}`;
          const mentionMessage =
            username || `[${ctx.from?.first_name}](${userLink})`;
          const userForm = await this.getUserFormDataFromDatabase(userId);
          if (userForm) {
            await ctx.telegram.sendMessage(
              previousUserId,
              `👀Один краш поставив вподобайку твоєму профілю, щоб переглянути хто це перейди у *архів лайків* 🗄`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  keyboard: [['🗄 Перейти у архів']],
                  resize_keyboard: true,
                },
              }
            );
            await this.client.connect();
            const db = this.client.db('cluster0');
            await db.collection('matches').insertOne({
              senderId: userId,
              receiverId: previousUserId,
              senderMentionMessage: mentionMessage,
            });
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
          }
          // await ctx.telegram.sendMessage(
          //   previousUserId,
          //   `${this.userForm.username} запрошує тебе на подію ${eventName} ${eventDate}. Обговори деталі...`,
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
        } catch (error) {
          console.error('Error sending notification:', error);
        }
      }

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
    lookForMatch.hears('👎', async (ctx) => {
      await this.registerUserLastActivity(ctx.from.id);
      currentUserIndex++;
      await this.sendUserDetails(
        userMatchForms as unknown as UserForm[],
        currentUserIndex,
        ctx
      );
      if (currentUserIndex > 0) {
        const previousUser = userMatchForms[currentUserIndex - 1];
        const previousUserId = previousUser.userId;
        const viewerUserId = this.userForm.userId;
        if (previousUserId) {
          await this.client.connect();
          const db = this.client.db('cluster0');
          await db.collection('viewed_profiles').insertOne({
            viewerUserId: viewerUserId,
            viewedUserId: previousUserId,
            expiryTimestamp: new Date(Date.now() + 10 * 1000),
          });
        }
      }
    });
    lookForMatch.hears('Скарга', async (ctx) => {
      this.reportedUserId = userMatchForms[currentUserIndex]?.userId;
      ctx.scene.enter('complaint');
      currentUserIndex++;
    });
    this.addCommands(lookForMatch);
    lookForMatch.on('message', async (ctx) => {
      await ctx.reply(
        '❤️ — якщо людина подобається, 👎 — якщо ні, скарга — якщо людина, на твою думку, погано себе веде. Все просто 😉'
      );
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
        await this.client.connect();
        const db = this.client.db('cluster0');
        await db.collection('viewed_profiles').insertOne({
          viewerUserId: ctx.from!.id,
          viewedUserId: this.reportedUserId,
          expiryTimestamp: new Date(Date.now() + 10 * 1000),
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
      await this.client.connect();
      const db = this.client.db('cluster0');
      const existingComplaint = await db
        .collection('complaints')
        .findOne({ userId: this.reportedUserId });

      const updateData = {
        $inc: { complaintsNum: 1 },
        $push: { descriptions: complaintDescription },
      };

      if (!existingComplaint) {
        await db.collection('complaints').insertOne({
          userId: this.reportedUserId,
          complaintsNum: 1,
          descriptions: [complaintDescription],
        });
      } else {
        await db
          .collection('complaints')
          .updateOne({ userId: this.reportedUserId }, updateData);
      }

      await ctx.reply(
        'Ви відправили скаргу на профіль. Дякуємо за Ваше повідомлення, ми розберемось з порушником 👮‍♂️',
        Markup.removeKeyboard()
      );
      await db.collection('viewed_profiles').insertOne({
        viewerUserId: ctx.from!.id,
        viewedUserId: this.reportedUserId,
        expiryTimestamp: new Date(Date.now() + 10 * 1000),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matches: any[];
    let currentIndex = 0;
    likeArchive.enter(async (ctx) => {
      currentIndex = 0;
      await this.client.connect();
      const db = this.client.db('cluster0');
      const userForm = (await db
        .collection('users')
        .findOne({ userId: ctx.from!.id })) as unknown as UserForm;
      Object.assign(this.userForm, userForm);
      matches = await db
        .collection('matches')
        .find({ receiverId: ctx.from!.id })
        .toArray();
      if (matches.length > 0) {
        await ctx.reply(`Кількіть твоїх вподобань — *${matches.length}*`, {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [['❤️', '👎']],
            resize_keyboard: true,
          },
        });
        const user = await db
          .collection('users')
          .findOne({ userId: matches[currentIndex].senderId });
        if (user) {
          const caption =
            `*Ім'я:* ${user.username}
*Вік:* ${user.age}
*Місто:* ${user.location}` +
            (user.about ? `\n\n*Про себе:* ${user.about}` : '');
          const mediaGroup: MediaGroup = this.userForm.mediaIds.map(
            (mediaObj: { type: string; id: string }, index: number) => ({
              type: mediaObj.type as 'document',
              media: mediaObj.id,
              caption: index === 0 ? caption : undefined,
              parse_mode: index === 0 ? 'Markdown' : undefined,
            })
          );
          await ctx.replyWithMediaGroup(mediaGroup);
          currentIndex++;
        } else {
          await ctx.reply(
            `Схоже це все\n\n Можеш розпочати пошук або переглянути свій профіль\n👫 — Розпочати звичайний пошук\n👤 — Переглянути свій профіль`,
            Markup.keyboard([['👫', '👤']])
              .oneTime()
              .resize()
          );
        }
      } else {
        await ctx.reply(
          `Схоже тебе ще ніхто не вподобав\n\n Можеш розпочати пошук або переглянути свій профіль\n👫 — Розпочати звичайний пошук\n👤 — Переглянути свій профіль`,
          Markup.keyboard([['👫', '👤']])
            .oneTime()
            .resize()
        );
      }
    });
    likeArchive.hears('❤️', async (ctx) => {
      const caption =
        `*Ім'я:* ${this.userForm.username}
*Вік:* ${this.userForm.age}
*Місто:* ${this.userForm.location}` +
        (this.userForm.about ? `\n\n*Про себе:* ${this.userForm.about}` : '');
      const mediaGroup: MediaGroup = this.userForm.mediaIds.map(
        (mediaObj: { type: string; id: string }, index: number) => ({
          type: mediaObj.type as 'document',
          media: mediaObj.id,
          caption: index === 0 ? caption : undefined,
          parse_mode: index === 0 ? 'Markdown' : undefined,
        })
      );
      let username = ctx.from?.username;
      if (username) {
        username = '@' + username;
      }
      const userId = ctx.from!.id;
      const userLink = `tg://user?id=${userId}`;
      const mentionMessage =
        username || `[${ctx.from?.first_name}](${userLink})`;
      await ctx.reply(
        `Бажаємо весело провести час\nПосилання на користувача: ${
          matches[currentIndex - 1].senderMentionMessage
        }`,
        {
          parse_mode: 'Markdown',
        }
      );
      await ctx.telegram.sendMediaGroup(
        matches[currentIndex - 1].senderId,
        mediaGroup
      );
      await ctx.telegram.sendMessage(
        matches[currentIndex - 1].senderId,
        `Ви отримали взаємний лайк. Бажаємо весело провести час\nПосилання на користувача: ${mentionMessage}`,
        {
          parse_mode: 'Markdown',
        }
      );
      await this.client.connect();
      const db = this.client.db('cluster0');
      await db.collection('matches').deleteMany({
        $or: [
          {
            senderId: this.userForm.userId,
            receiverId: matches[currentIndex - 1].senderId,
          },
          {
            senderId: matches[currentIndex - 1].senderId,
            receiverId: this.userForm.userId,
          },
        ],
      });
      if (matches.length > currentIndex) {
        const user = await db
          .collection('users')
          .findOne({ userId: matches[currentIndex].senderId });
        if (user) {
          const caption =
            `*Ім'я:* ${user.username}
  *Вік:* ${user.age}
  *Місто:* ${user.location}` +
            (user.about ? `\n\n*Про себе:* ${user.about}` : '');
          const mediaGroup: MediaGroup = this.userForm.mediaIds.map(
            (mediaObj: { type: string; id: string }, index: number) => ({
              type: mediaObj.type as 'document',
              media: mediaObj.id,
              caption: index === 0 ? caption : undefined,
              parse_mode: index === 0 ? 'Markdown' : undefined,
            })
          );
          await ctx.replyWithMediaGroup(mediaGroup);
          currentIndex++;
        }
      } else {
        await ctx.reply(
          `Схоже це все\n\n Можеш розпочати пошук або переглянути свій профіль\n👫 — Розпочати звичайний пошук\n👤 — Переглянути свій профіль`,
          Markup.keyboard([['👫', '👤']])
            .oneTime()
            .resize()
        );
      }
    });
    likeArchive.hears('👎', async (ctx) => {
      await this.client.connect();
      const db = this.client.db('cluster0');
      const user = await db
        .collection('users')
        .findOne({ userId: matches[currentIndex].senderId });
      if (user) {
        const caption =
          `*Ім'я:* ${user.username}
*Вік:* ${user.age}
*Місто:* ${user.location}` +
          (user.about ? `\n\n*Про себе:* ${user.about}` : '');
        const mediaGroup: MediaGroup = this.userForm.mediaIds.map(
          (mediaObj: { type: string; id: string }, index: number) => ({
            type: mediaObj.type as 'document',
            media: mediaObj.id,
            caption: index === 0 ? caption : undefined,
            parse_mode: index === 0 ? 'Markdown' : undefined,
          })
        );
        await ctx.replyWithMediaGroup(mediaGroup);
        currentIndex++;
      } else {
        await ctx.reply(
          `Схоже це все\n\n Можеш розпочати пошук або переглянути свій профіль\n👫 — Розпочати звичайний пошук\n👤 — Переглянути свій профіль`,
          Markup.keyboard([['👫', '👤']])
            .oneTime()
            .resize()
        );
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
    });
    this.addCommands(promocode);
    promocode.hears('👤 Створити профіль', async (ctx) => {
      await ctx.scene.enter('userform');
    });
    promocode.on('text', async (ctx) => {
      const userCode = ctx.message.text;
      await this.client.connect();
      const db = this.client.db('cluster0');
      const promoCode = await db
        .collection('promocodes')
        .findOne({ promocode: userCode });
      if (promoCode) {
        const user = await db
          .collection('users')
          .findOne({ userId: ctx.from.id });
        if (user) {
          Object.assign(this.userForm, user);
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
                      subscriptionDurationMs = 60 * 60 * 1000; // 1 hour (for testing)
                      break;
                    case '6 місяців':
                      subscriptionDurationMs = 60 * 60 * 2 * 1000; // 2 hours
                      break;
                    case '1 рік':
                      subscriptionDurationMs = 60 * 60 * 3 * 1000; // 3 hours
                      break;
                  }
                  const premiumEndTime = new Date();
                  premiumEndTime.setTime(
                    premiumEndTime.getTime() + subscriptionDurationMs
                  );
                  await this.client.connect();
                  const db = this.client.db('cluster0');
                  await db.collection('users').updateOne(
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
                  await db.collection('promocodes').updateOne(
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
      if (this.userForm.isPremium) {
        const buttonText = this.userForm.showPremiumLabel
          ? '⭐️ — Сховати надпис'
          : '⭐️ — Показати надпис';
        await ctx.reply(
          `${buttonText} ⭐️ *Premium Crush* в профілі\n❤️ — Сховати статистику під профілем (ще не створено)\n<Вставити смайл> — Переглянути свою статистику (ще не створено)`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [['⭐️']],
              resize_keyboard: true,
            },
          }
        );
      }
    });
    premiumSettings.hears('⭐️', async (ctx) => {
      const message = this.userForm.showPremiumLabel
        ? '✅ Надпис прибрано'
        : '✅ Надпис додано';
      this.client.connect();
      const db = this.client.db('cluster0');
      const updateField = this.userForm.showPremiumLabel
        ? { showPremiumLabel: false }
        : { showPremiumLabel: true };
      await db
        .collection('users')
        .updateOne({ userId: ctx.from.id }, { $set: updateField });
      this.userForm.showPremiumLabel = !this.userForm.showPremiumLabel;
      await ctx.reply(message, Markup.removeKeyboard());
    });
    this.addCommands(premiumSettings);
    premiumSettings.on('message', async (ctx) => {
      if (this.userForm.isPremium) {
        const buttonText = this.userForm.showPremiumLabel
          ? '⭐️ — Сховати надпис'
          : '⭐️ — Показати надпис';
        await ctx.reply(
          `${buttonText} ⭐️ *Premium Crush* в профілі\n❤️ — Сховати статистику під профілем (ще не створено)\n<Вставити смайл> — Переглянути свою статистику (ще не створено)`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [['⭐️']],
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
      await this.client.connect();
      const db = this.client.db('cluster0');
      complaints = await db.collection('complaints').find().toArray();
      const reportedUserIds = complaints.map((complaint) => complaint.userId);
      reportedUsers = (await db
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
        await this.client.connect();
        const db = this.client.db('cluster0');
        const banData = await db
          .collection('bans')
          .findOne({ userId: reportedUser.userId });
        const banCount = banData ? banData.banCount : 0;
        const banDuration =
          banCount === 0
            ? 60 * 1000
            : banCount === 1
            ? 30 * 24 * 60 * 60 * 1000
            : 10 * 365 * 24 * 60 * 60 * 1000;
        const banExpirationDate = new Date(Date.now() + banDuration);
        await db.collection('bans').updateOne(
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
      await this.client.connect();
      const db = this.client.db('cluster0');
      await db
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
      Object.assign(this.userForm, user);
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
      await ctx.scene.enter('greeting');
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
      await ctx.scene.enter('greeting');
    });
    return help;
  }
  async sendReportedProfile(
    ctx: MySceneContext,
    reportedUser: UserForm,
    complaintsNum: number,
    descriptions: string[]
  ) {
    await this.client.connect();
    const db = this.client.db('cluster0');
    const banData = await db
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
*Про себе:* ${reportedUser.about}
 
*Причини скарг:*
${complaintsList}`;
    const mediaGroup: MediaGroup = this.userForm.mediaIds.map(
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
      await ctx.scene.enter('greeting');
    });
    scene.command('events', async (ctx) => {
      await ctx.scene.enter('eventList');
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
    scene.hears('👫 Звичайний пошук', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    scene.hears('🍾 Події', async (ctx) => {
      await ctx.scene.enter('eventList');
    });
    scene.hears('🗄 Перейти у архів', async (ctx) => {
      await ctx.scene.enter('likeArchive');
    });
    scene.command('premiumTest', async (ctx) => {
      // TEST FUNC DELETE IN PROD!!!!!
      const subscriptionDurationMs = 10 * 60 * 1000; // 10 min
      const premiumEndTime = new Date();
      premiumEndTime.setTime(premiumEndTime.getTime() + subscriptionDurationMs);
      await this.client.connect();
      const db = this.client.db('cluster0');
      await db.collection('users').updateOne(
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
      await this.client.connect();
      const userFormData = new UserFormModel<UserForm>(userForm);
      const db = this.client.db('cluster0');
      const user = await db
        .collection('users')
        .findOne({ userId: userForm.userId });
      if (user) {
        await db.collection('users').updateOne(
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
              actualLocation: userForm.actualLocation,
              location: userForm.location,
              mediaIds: userForm.mediaIds,
              likesSentCount: userForm.likesSentCount,
              isActive: userForm.isActive,
              isPremium: userForm.isPremium,
              premiumEndTime: userForm.premiumEndTime,
              showPremiumLabel: userForm.showPremiumLabel,
              lastActive: userForm.lastActive,
            },
          }
        );
      } else {
        await db.collection('users').insertOne(userFormData);
      }
    } catch (error) {
      console.error('Error saving UserForm data:', error);
    } finally {
      await this.client.close();
    }
  }
  async saveEventToDatabase(event: Event) {
    try {
      await this.client.connect();
      const eventData = new EventModel<Event>(event);
      const db = this.client.db('cluster0');
      await db.collection('events').insertOne(eventData);
    } catch (error) {
      console.error('Error saving eventData data:', error);
    } finally {
      await this.client.close();
    }
  }
  async getUserFormDataFromDatabase(userId: number) {
    try {
      await this.client.connect();
      const db = this.client.db('cluster0');
      const userForm = await db.collection('users').findOne({ userId });
      return userForm;
    } catch (error) {
      console.error('Error getting userForm data from db', error);
    } finally {
      await this.client.close();
    }
  }
  async registerUserLastActivity(userId: number) {
    await this.client.connect();
    const db = this.client.db('cluster0');
    await db.collection('users').updateOne(
      { userId },
      {
        $set: {
          lastActive: new Date().toLocaleString(),
        },
      }
    );
  }
  async getEventsFromDatabase(userId: number, userGender: string) {
    try {
      await this.client.connect();
      const db = this.client.db('cluster0');
      const events = await db
        .collection('events')
        .find({
          userId: { $ne: userId },
          lookingFor: { $in: [userGender, 'both'] },
        })
        .toArray();
      return events;
    } catch (error) {
      console.error('Error getting events data from db', error);
    }
  }

  async getUserEventsFromDatabase(userId: number) {
    try {
      await this.client.connect();
      const db = this.client.db('cluster0');
      const events = await db
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
  async getEventFromDatabase(userId: number) {
    try {
      await this.client.connect();
      const db = this.client.db('cluster0');
      const event = await db.collection('events').findOne({
        userId: userId,
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
      const caption =
        (user.isPremium ? `⭐️ *Premium Crush*\n\n` : '') +
        `*Ім'я:* ${user.username}
*Вік:* ${user.age}
*Місто:* ${user.location}` +
        (user.about ? `\n\n*Про себе:* ${user.about}` : '');
      const mediaGroup: MediaGroup = this.userForm.mediaIds.map(
        (mediaObj: { type: string; id: string }, index: number) => ({
          type: mediaObj.type as 'document',
          media: mediaObj.id,
          caption: index === 0 ? caption : undefined,
          parse_mode: index === 0 ? 'Markdown' : undefined,
        })
      );
      await ctx.telegram.sendMediaGroup(ctx.from!.id, mediaGroup);
      return user;
    } else {
      await ctx.reply(
        'Більше немає людей, які підходять під твої запити',
        Markup.removeKeyboard()
      );
    }
  }

  showUserProfile(userForm: UserForm): MediaGroup {
    const caption =
      (userForm.isPremium && -userForm.showPremiumLabel
        ? `⭐️ *Premium Crush*\n\n`
        : '') +
      `Так виглядає твій профіль:
*Ім'я:* ${userForm.username}
*Вік:* ${userForm.age}
*Місто:* ${userForm.location}` +
      (userForm.about ? `\n\n*Про себе:* ${userForm.about}` : '');
    const mediaGroup: MediaGroup = this.userForm.mediaIds.map(
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
      const message = `Назва події: ${event.eventName}\nДата та час події: ${event.date}`;
      const inlineKeyboardMarkup = Markup.inlineKeyboard([
        Markup.button.callback(
          '✅ Хочу піти',
          `inviteToEvent:${eventInitiatorId}`
        ),
        Markup.button.callback('❌ Наступна подія', `nextEvent`),
      ]);

      if (event.about) {
        await ctx.reply(
          `${message}\nДеталі: ${event.about}`,
          inlineKeyboardMarkup
        );
      } else {
        await ctx.reply(message, inlineKeyboardMarkup);
      }
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
      const message = `Назва події: ${event.eventName}\nДата та час події: ${event.date}`;
      const inlineKeyboardMarkup = Markup.inlineKeyboard([
        Markup.button.callback(
          '❌ Видалити подію',
          `deleteEvent:${event.userId}`
        ),
      ]);

      if (event.about) {
        await ctx.reply(
          `${message}\nДеталі: ${event.about}`,
          inlineKeyboardMarkup
        );
      } else {
        await ctx.reply(message, inlineKeyboardMarkup);
      }
    } else {
      await ctx.reply(
        'Подій більше немає, можеш створити нову',
        Markup.removeKeyboard()
      );
    }
  }
}
