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
//import readline from 'readline';

export class SceneGenerator {
  constructor(
    private readonly client: MongoClient,
    private configService: IConfigService
  ) {}
  API_KEY = this.configService.get('API_KEY');
  userForm: UserForm = {
    userId: NaN,
    username: '',
    gender: 'male',
    lookingFor: 'both',
    age: NaN,
    about: undefined,
    actualLocation: {
      longitude: NaN,
      latitude: NaN,
    },
    location: '',
    photoId: '',
  };
  event: Event = {
    userId: NaN,
    eventId: NaN,
    eventName: '',
    date: '',
    about: undefined,
    //ageRange: '',
  };

  greetingScene(): Scenes.BaseScene<MySceneContext> {
    const greeting = new Scenes.BaseScene<MySceneContext>('greeting');
    greeting.enter(async (ctx) => {
      await ctx.reply('⬇️⁣', Markup.keyboard([['Створити профіль']]).resize());
    });
    greeting.hears('Створити профіль', async (ctx) => {
      ctx.scene.enter('gender');
    });
    this.addCommands(greeting);
    greeting.on('message', async (ctx) => {
      await ctx.reply(
        'Обирай дії в меню ⬇️',
        Markup.keyboard([['Створити профіль']]).resize()
      );
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
      if (ctx.message.text === 'Пропустити') {
        return;
      }
      if (ctx.message.text.length > 140) {
        await ctx.reply('Занадто велике повідомлення, зроби трохи меншим');
      } else {
        this.userForm.about = ctx.message.text;
        ctx.scene.enter('userform');
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
        this.userForm.actualLocation = userLocationName;
        this.userForm.location = userLocationName;
        await ctx.scene.enter('photo');
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

          if (
            ['city', 'urban', 'settlement', 'village', 'state'].includes(type)
          ) {
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
      const priorityOrder = ['city', 'urban', 'state', 'settlement', 'village'];
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
        await ctx.reply(`Твоє місто: ${matchingCities[0].item.original}`);
        await ctx.scene.enter('photo');
      } else {
        await ctx.reply('Не знаємо таке місто, перевір правильність написання');
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
  photoScene(): Scenes.BaseScene<MySceneContext> {
    const photo = new Scenes.BaseScene<MySceneContext>('photo');
    photo.enter(async (ctx) => {
      await ctx.reply(
        'Обери свої найкращі фото або відео, які будуть бачити інші'
      ),
        Markup.removeKeyboard();
    });
    this.addCommands(photo);
    photo.on('photo', async (ctx) => {
      const photos = ctx.message.photo;
      photos.sort((a, b) => {
        const resolutionA = a.width * a.height;
        const resolutionB = b.width * b.height;
        return resolutionB - resolutionA;
      });
      this.userForm.photoId = photos[0].file_id;
      await this.saveUserFormToDatabase(this.userForm);
      await ctx.scene.enter('about');
    });
    photo.on('text', async (ctx) => {
      await ctx.reply('Завантаж, будь-ласка, своє фото');
    });
    photo.on('message', async (ctx) => {
      await ctx.reply('Завантаж, будь-ласка, своє фото');
    });
    return photo;
  }
  userFormScene(): Scenes.BaseScene<MySceneContext> {
    const userFormScene = new Scenes.BaseScene<MySceneContext>('userform');
    userFormScene.enter(async (ctx) => {
      const userId = ctx.message?.from.id;
      if (userId) {
        const userForm = await this.getUserFormDataFromDatabase(userId);
        if (userForm) {
          let caption = '';
          caption = `Так виглядає твій профіль:
Ім'я: ${userForm.username}
Вік: ${userForm.age}
Місто: ${userForm.location}`;
          if (userForm.about) {
            caption = `\nПро себе: ${userForm.about}`;
          }
          await ctx.replyWithPhoto(userForm.photoId, { caption });
          await ctx.reply(
            `✍🏻Редагувати профіль
🆕Додати подію
🎟Мої події
❌Видалити профіль`,
            Markup.keyboard([['✍🏻', '🆕', '🎟', '❌']]).resize()
          );
          // userFormScene.on('text', (ctx) => {
          //   console.log('text')
          //   ctx.reply('', Markup.removeKeyboard())
          // })

          userFormScene.hears('✍🏻', async (ctx) => {
            // await ctx.editMessageReplyMarkup({
            //   reply_markup: { remove_keyboard: true },
            //   })
            await ctx.scene.enter('gender');
          });
          userFormScene.hears('🆕', async (ctx) => {
            await ctx.scene.enter('eventName');
          });
          userFormScene.hears('🎟', async (ctx) => {
            await ctx.scene.enter('userEvents');
          });
          userFormScene.hears('❌', async (ctx) => {
            await this.client.connect();
            const db = this.client.db('cluster0');
            await db.collection('users').deleteOne({ userId: ctx.from.id });
            await ctx.reply('Твій профіль видалено', Markup.removeKeyboard());
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
      await ctx.scene.enter('userEvents');
    });
    eventMenu.on('message', async (ctx) => {
      await ctx.reply('Додай подію або обери зі списку');
    });
    return eventMenu;
  }
  eventNameScene(): Scenes.BaseScene<MySceneContext> {
    const eventName = new Scenes.BaseScene<MySceneContext>('eventName');
    eventName.enter(async (ctx) => {
      ctx.reply('Вкажи назву події', Markup.removeKeyboard());
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
      ctx.reply('Вкажи деталі події', Markup.keyboard(['Пропустити']).resize());
    });
    this.addCommands(eventAbout);
    eventAbout.hears('Пропустити', async (ctx) => {
      this.event.about = undefined;
      await ctx.scene.enter('eventAgeRange');
    });
    eventAbout.on('text', async (ctx) => {
      this.event.about = ctx.message.text;
      await ctx.scene.enter('eventAgeRange');
    });
    eventAbout.on('message', async (ctx) => {
      await ctx.reply('Вкажи деталі події');
    });

    return eventAbout;
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

  userEventListScene(): Scenes.BaseScene<MySceneContext> {
    const userEvents = new Scenes.BaseScene<MySceneContext>('userEvents');
    let currentEventIndex = 0;
    let currentUserIndex = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let events: any;
    userEvents.enter(async (ctx) => {
      events = await this.getEventsFromDatabase(ctx.from!.id);
      currentEventIndex = 0;
      this.userForm.userId = ctx.from!.id;
      if (events && events.length > 0) {
        await ctx.reply(`Ось твої події:`, Markup.removeKeyboard());
        await this.showEvent(events, currentEventIndex, ctx);
      } else {
        await ctx.reply('Ти ще не створив жодної події');
      }
    });
    userEvents.action('nextEvent', async (ctx) => {
      currentEventIndex++;
      await this.showEvent(events, currentEventIndex, ctx);
    });
    const regex = new RegExp(/^inviteToEvent:(.*):(.*)$/);
    userEvents.action(regex, async (ctx) => {
      currentUserIndex = 0;
      const userId = ctx.from!.id;
      //const eventAgeRange = ctx.match[1];
      const eventName = ctx.match[1];
      const eventDate = ctx.match[2];
      try {
        const userFormData = await this.getUserFormDataFromDatabase(userId);
        if (userFormData) {
          Object.assign(this.userForm, userFormData);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: any = {
          userId: { $ne: userId },
          actuallocation: this.userForm.actualLocation,
          gender:
            this.userForm.lookingFor === 'both'
              ? { $in: ['male', 'female'] }
              : this.userForm.lookingFor,
        };
        // if (eventAgeRange === '18-20') {
        //   query.age = { $gte: 18, $lte: 20 };
        // } else if (eventAgeRange === '20-22') {
        //   query.age = { $gte: 20, $lte: 22 };
        // } else if (eventAgeRange === '22-25') {
        //   query.age = { $gte: 22, $lte: 25 };
        // }
        await this.client.connect();
        const db = this.client.db('cluster0');
        const userMatchForms = await db
          .collection('users')
          .find(query)
          .toArray();
        await this.sendUserDetails(
          userMatchForms as unknown as UserForm[],
          currentUserIndex,
          ctx
        );
        userEvents.hears('❤️', async () => {
          currentUserIndex++;
          this.sendUserDetails(
            userMatchForms as unknown as UserForm[],
            currentUserIndex,
            ctx
          );
          if (currentUserIndex > 0) {
            const previousUser = userMatchForms[currentUserIndex - 1];
            const previousUserId = previousUser.userId;
            try {
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
                await ctx.telegram.sendPhoto(previousUserId, userForm.photoId, {
                  caption: `${this.userForm.username}, ${this.userForm.age}, ${this.userForm.location}, хоче піти з тобою на подію ${eventName} ${eventDate}. Обговори деталі та приємно проведіть цей час 👋`,
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
                          callback_data: `dislikeEvent:${userId}:${ctx.from?.username}`,
                        },
                      ],
                    ],
                  },
                });
                await ctx.reply(
                  `Супер! Очікуй на повідомлення від ініціатора події 🥳 Бажаю приємно провести час 👋`,
                  Markup.removeKeyboard()
                );
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
        });
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
        userEvents.hears('👎', () => {
          currentUserIndex++;
          this.sendUserDetails(
            userMatchForms as unknown as UserForm[],
            currentUserIndex,
            ctx
          );
        });
      } catch (error) {
        console.error('Error getting userForm data from db', error);
      } finally {
        await this.client.close();
      }
    });
    this.addCommands(userEvents);
    return userEvents;
  }

  lookForMatchScene(): Scenes.BaseScene<MySceneContext> {
    const lookForMatch = new Scenes.BaseScene<MySceneContext>('lookForMatch');
    let currentUserIndex = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let userMatchForms: any;
    lookForMatch.enter(async (ctx) => {
      const userFormData = await this.getUserFormDataFromDatabase(ctx.from!.id);
      currentUserIndex = 0;
      if (userFormData) {
        Object.assign(this.userForm, userFormData);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = {
        userId: { $ne: this.userForm.userId },
        actualLocation: this.userForm.actualLocation,
        gender:
          this.userForm.lookingFor === 'both'
            ? { $in: ['male', 'female'] }
            : this.userForm.lookingFor,
      };
      await this.client.connect();
      const db = this.client.db('cluster0');
      userMatchForms = await db.collection('users').find(query).toArray();
      await this.sendUserDetails(
        userMatchForms as unknown as UserForm[],
        currentUserIndex,
        ctx
      );
    });
    lookForMatch.hears('❤️', async (ctx) => {
      currentUserIndex++;
      this.sendUserDetails(
        userMatchForms as unknown as UserForm[],
        currentUserIndex,
        ctx
      );
      if (currentUserIndex > 0) {
        const previousUser = userMatchForms[currentUserIndex - 1];
        const previousUserId = previousUser.userId;
        try {
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
            await ctx.telegram.sendPhoto(previousUserId, userForm.photoId, {
              caption: `Ти сподобався ${this.userForm.username}, ${this.userForm.age}, ${this.userForm.location}`,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: '❤️',
                      callback_data: `like:${userId}:${mentionMessage}`,
                    },
                    {
                      text: '👎',
                      callback_data: `dislike:${userId}:${ctx.from?.username}`,
                    },
                  ],
                ],
              },
            });
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
      lookForMatch.hears('👎', () => {
        currentUserIndex++;
        this.sendUserDetails(
          userMatchForms as unknown as UserForm[],
          currentUserIndex,
          ctx
        );
      });
    });
    this.addCommands(lookForMatch);
    return lookForMatch;
  }

  addCommands(scene: Scenes.BaseScene<MySceneContext>) {
    scene.command('start', async (ctx) => {
      await ctx.reply(`Вітаємо в ком'юніті Дай Винника! 👋
          
👩 Дай Винник — незвичайний бот, який наповнить твоє життя приємними моментами. Він допоможе тобі знайти компаньона на якусь подію або просто прогулянку, а також знайти другу половинку, друга або подругу!
                        
🫂 Офіційний запуск повноцінного боту планується 27 серпня. Проте ти вже можеш створити й налаштувати свій профіль. Міцно обійняли тебе`);
      await ctx.scene.enter('greeting');
    });
    scene.command('events', async (ctx) => {
      await ctx.scene.enter('userEvents');
    });
    scene.command('people', async (ctx) => {
      await ctx.scene.enter('lookForMatch');
    });
    scene.command('help', async (ctx) => {
      await ctx.reply(
        `🦸‍♀️ Маєш питання або пропозиції?
      
Пиши нам сюди [Олексій](tg://user?id=546195130)`,
        { parse_mode: 'Markdown' }
      );
    });
    scene.command('profile', async (ctx) => {
      await ctx.scene.enter('userform');
    });
  }

  async saveUserFormToDatabase(userForm: UserForm) {
    try {
      await this.client.connect();
      const userFormData = new UserFormModel<UserForm>(userForm);
      const db = this.client.db('cluster0');
      if (await db.collection('users').findOne({ userId: userForm.userId })) {
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
              photoId: userForm.photoId,
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
  async getEventsFromDatabase(userId: number | undefined) {
    try {
      await this.client.connect();
      const db = this.client.db('cluster0');
      const events = await db.collection('events').find({ userId }).toArray();
      return events;
    } catch (error) {
      console.error('Error getting events data from db', error);
    } finally {
      await this.client.close();
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
      let caption = '';
      if (user.about) {
        caption = `Ім'я: ${user.username}
Вік: ${user.age}
Місто: ${user.location}
Про себе: ${user.about}`;
      } else {
        caption = `Ім'я: ${user.username}
Вік: ${user.age}
Місто: ${user.location}`;
      }
      await ctx.replyWithPhoto(user.photoId, {
        caption,
        reply_markup: {
          keyboard: [['❤️', '👎']],
          resize_keyboard: true,
        },
      });
    } else {
      await ctx.reply(
        'Більше немає людей, які підходять під твої запити',
        Markup.removeKeyboard()
      );
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async showEvent(events: any, currentIndex: number, ctx: MySceneContext) {
    const event = events[currentIndex];
    if (event) {
      const message = `Назва події: ${event.eventName}\nДата та час події: ${event.date}`;
      const inlineKeyboardMarkup = Markup.inlineKeyboard([
        Markup.button.callback(
          '✅ Хочу піти',
          `inviteToEvent:${event.eventName}:${event.date}`
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
      await ctx.reply('В тебе більше немає подій', Markup.removeKeyboard());
    }
  }
}
