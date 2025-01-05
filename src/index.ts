import { Context, h, Logger, Schema, Time } from 'koishi';
import {} from 'koishi-plugin-cron';
import { createHash } from 'node:crypto';

export const name = 'news';

export const inject = ['database']

declare module 'koishi' {
  interface Tables {
    news: News;
  }
}

export interface News {
  time: string;
  img: string;
}

export interface Config {
  point: number[];
  days: number;
  api: string;
}

export const Config: Schema<Config> = Schema.object({
  point: Schema.tuple([
    Schema.number().min(0).max(24),
    Schema.number().min(0).max(59),
  ])
    .default([8, 0])
    .description('小时，分钟，固定每天多少点发'),
  days: Schema.number().default(7).description('数据库保留多少天新闻'),
  api: Schema.string().role('link').default('http://dwz.2xb.cn/zaob'),
});

export function apply(ctx: Context, config: Config) {
  const commonAPI = 'https://ravelloh.github.io/EverydayNews'; // + /2024/03/2024-03-08.jpg
  const logger = ctx?.logger || new Logger(name);
  ctx.inject(['cron'], (ctx) => {
    ctx.cron(`${config.point[1]} ${config.point[0]} * * *`, async () => {
      let img = await getImage();
      await ctx.broadcast(h('image', { url: `data:image/jpg;base64,${img}` }));
    });
  });

  ctx.model.extend(
    'news',
    { time: 'string', img: 'text' },
    { primary: 'time' },
  );

  ctx.command('news [date:text]').action(async (_, date) => {
    if (date && isValidDate(date) == false) {
      return '你输入的不是一个有效的日期噢，按照 2024-03-10 的格式。';
    }
    let img;
    try {
      img = await getImage(date);
    } catch (e) {
      logger.error(e);
      return e.message;
    }
    return h('image', { url: `data:image/jpg;base64,${img}` });
  });

  async function getImage(date?: string): Promise<string> {
    if (date) {
      let databaseImg = await ctx.database.get('news', date);
      if (databaseImg.length !== 1) {
        const time = date.split('-');
        const img = await fetchNewsImage(
          commonAPI + `/${time[0]}/${time[1]}/${date}.jpg`,
        );
        await ctx.database.create('news', { time: date, img });
        return img;
      }
      return databaseImg[0].img;
    }
    let databaseImg = await ctx.database.get('news', getCurrentDate());
    if (databaseImg.length == 1) return databaseImg[0].img;
    const img = await fetchNewsImage(ctx.config.api);
    const yesterday = await ctx.database.get(
      'news',
      convertToPastDateString(getCurrentDate()),
    );
    if (yesterday.length !== 0) {
      const yesterdayImg = yesterday[0].img;
      const yesterdayHash = getHashFromBase64(yesterdayImg);
      const todayHash = getHashFromBase64(img);
      if (yesterdayHash == todayHash)
        throw Error('API 返回了和昨天相同的图片。');
    }
    await ctx.database.remove('news', {
      // 字符串比较按词典顺序来比，格式一定比较天数一定正确。
      time: { $lt: convertToPastDateString(getCurrentDate(), config.days) },
    });
    await ctx.database.create('news', { time: getCurrentDate(), img });
    return img;
  }

  async function fetchNewsImage(url: string): Promise<string> {
    logger.info(`正在从 ${url} 获取图片`);
    try {
      // 尝试请求获取数据
      const response = await ctx.http.get(url, { responseType: 'arraybuffer' });

      // 判断是否为有效图片格式的工具函数
      const isValidImage = (buffer: ArrayBuffer): boolean => {
        const signatures = [
          { ext: 'jpg', magic: [0xFF, 0xD8, 0xFF] },
          { ext: 'png', magic: [0x89, 0x50, 0x4E, 0x47] },
          { ext: 'gif', magic: [0x47, 0x49, 0x46] },
          { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
        ];
        const bufferView = new Uint8Array(buffer);
        return signatures.some(sig => sig.magic.every((byte, index) => bufferView[index] === byte));
      };

      // 尝试将响应解析为 JSON
      let parsedResponse;
      try {
        const textResponse = new TextDecoder('utf-8').decode(response); // 使用 TextDecoder 解码 ArrayBuffer
        parsedResponse = JSON.parse(textResponse);

        // 遍历 JSON 查找 HTTP 链接
        const findHttpUrl = (obj: any): string | null => {
          if (typeof obj === 'string' && obj.startsWith('http')) {
            return obj;
          } else if (typeof obj === 'object') {
            for (const key in obj) {
              const result = findHttpUrl(obj[key]);
              if (result) return result;
            }
          }
          return null;
        };

        const imageUrl = findHttpUrl(parsedResponse);
        if (imageUrl) {
          logger.info(`检测到 JSON 响应中的 HTTP 链接，尝试从 ${imageUrl} 获取图片`);
          const imageResponse = await ctx.http.get(imageUrl, { responseType: 'arraybuffer' });
          if (isValidImage(imageResponse)) {
            return Buffer.from(imageResponse).toString('base64');
          } else {
            throw new Error('从链接获取的不是有效图片');
          }
        }

        throw new Error('JSON 数据中未找到有效的图片链接');
      } catch (jsonError) {
        logger.warn('响应不是 JSON，继续检查是否为图片 buffer');
      }

      // 检查数据是否为图片 buffer
      if (isValidImage(response)) {
        logger.info('直接返回图片 buffer');
        return Buffer.from(response).toString('base64');
      }

      throw new Error('数据既不是 JSON 也不是图片');
    } catch (error) {
      logger.error('获取图片时出错:', error.message);
      throw error;
    }
  }
}

function convertToPastDateString(date: string, days: number = 1): string {
  const dateParts = date.split('-').map((part) => parseInt(part, 10));
  const year = dateParts[0];
  const month = dateParts[1];
  const day = dateParts[2];

  const dateObj = new Date(year, month - 1, day);
  dateObj.setDate(dateObj.getDate() - days);

  const pastYear = dateObj.getFullYear();
  const pastMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
  const pastDay = String(dateObj.getDate()).padStart(2, '0');

  return `${pastYear}-${pastMonth}-${pastDay}`;
}

function isValidDate(str: string): boolean {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  return pattern.test(str) && !isNaN(new Date(str).getTime());
}

function getCurrentDate(): string {
  return Time.template('yyyy-MM-dd');
}

function getHashFromBase64(base64: string): string {
  const buffer = Buffer.from(base64, 'base64');
  return createHash('sha256').update(buffer).digest('hex');
}
