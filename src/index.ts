import { Context, h, Schema, Time } from 'koishi';
import {} from 'koishi-plugin-cron';
import { createHash } from 'node:crypto';

export const name = 'news';

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
  api: string;
}

export const Config: Schema<Config> = Schema.object({
  point: Schema.tuple([
    Schema.number().min(0).max(24),
    Schema.number().min(0).max(59),
  ])
    .default([8, 0])
    .description('小时，分钟，固定每天多少点发'),
  api: Schema.string().role('link').default('https://api.03c3.cn/api/zb'),
});

export function apply(ctx: Context, config: Config) {
  const commonAPI = 'https://ravelloh.github.io/EverydayNews'; // + /2024/03/2024-03-08.jpg
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
      ctx?.logger.error(e);
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
      convertToYesterdayString(getCurrentDate()),
    );
    if (yesterday.length !== 0) {
      const yesterdayImg = yesterday[0].img;
      const yesterdayHash = getHashFromBase64(yesterdayImg);
      const todayHash = getHashFromBase64(img);
      if (yesterdayHash == todayHash)
        throw Error('API 返回了和昨天相同的图片。');
    }
    await ctx.database.create('news', { time: getCurrentDate(), img });
    return img;
  }

  async function fetchNewsImage(url: string): Promise<string> {
    ctx?.logger.info(`正在从 ${url} 获取图片`);
    try {
      const response = await ctx.http.get(url);
      return Buffer.from(response).toString('base64');
    } catch (error) {
      ctx?.logger.error('Error fetching image:', error.message);
      throw error;
    }
  }
}

function convertToYesterdayString(date: string): string {
  const dateParts = date.split('-').map((part) => parseInt(part, 10));
  const year = dateParts[0];
  const month = dateParts[1];
  const day = dateParts[2];

  const dateObj = new Date(year, month - 1, day);
  dateObj.setDate(dateObj.getDate() - 1);

  const yesterYear = dateObj.getFullYear();
  const yesterMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
  const yesterDay = String(dateObj.getDate()).padStart(2, '0');

  return `${yesterYear}-${yesterMonth}-${yesterDay}`;
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
