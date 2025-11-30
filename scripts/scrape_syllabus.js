/**
 * 高専Webシラバスからカリキュラム情報をスクレイピングするスクリプト
 * 使用方法: node scripts/scrape_syllabus.js <year> <course_code>
 * 
 * department_id一覧 (明石高専 school_id=27):
 *   11: 機械工学科 (M)
 *   12: 電気情報工学科 (E) - 1-3年共通
 *   13: 電気情報工学科（電気電子工学コース）(ED) - 4-5年
 *   14: 電気情報工学科（情報工学コース）(EJ) - 4-5年
 *   15: 都市システム工学科 (C)
 *   16: 建築学科 (A)
 * 
 * ※ ED/EJ は1-3年をid=12から、4-5年をそれぞれのコースから取得
 * 
 * 例: node scripts/scrape_syllabus.js 2025 EJ
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// 学科コードとdepartment_idのマッピング
const DEPARTMENT_MAP = {
  'M':  11,  // 機械工学科
  'ED': 13,  // 電気情報工学科（電気電子工学コース）4-5年
  'EJ': 14,  // 電気情報工学科（情報工学コース）4-5年
  'C':  15,  // 都市システム工学科
  'A':  16,  // 建築学科
};

// 電気情報工学科 1-3年共通のdepartment_id
const E_COMMON_DEPARTMENT_ID = 12;

async function getCurriculumList(page, url) {
  console.log(`Fetching: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

  return await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    // 最も行数の多いテーブルがカリキュラムテーブル
    let curriculumTable = null;
    let maxRows = 0;
    tables.forEach(table => {
      if (table.rows.length > maxRows) {
        maxRows = table.rows.length;
        curriculumTable = table;
      }
    });

    if (!curriculumTable) {
      throw new Error('カリキュラムテーブルが見つかりません');
    }

    const rows = Array.from(curriculumTable.querySelectorAll('tr'));
    // 最初の4行はヘッダー
    const dataRows = rows.slice(4);

    const subjects = dataRows.map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 27) return null;

      // 科目区分: 一般 → 0, 専門 → 1
      const divideText = cells[0].textContent.trim();
      const divide = divideText === '一般' ? 0 : 1;

      // 必修/選択: 必修 → true, それ以外 → false
      const requiredText = cells[1].textContent.trim();
      const required = requiredText === '必修';

      // 科目名（重複テキストを削除）
      let title = cells[2].textContent.trim();
      // 改行で分割して最初の部分を取得（重複削除）
      const titleParts = title.split('\n').map(s => s.trim()).filter(s => s);
      title = titleParts[0] || title;

      // 単位数
      const credit = parseInt(cells[5].textContent.trim()) || 0;

      // 各クォーターの授業時数を取得して学年と開講期を判定
      const quarters = [];
      for (let i = 0; i < 20; i++) {
        const val = cells[6 + i].textContent.trim();
        quarters.push(val ? parseInt(val) || 0 : 0);
      }

      // 学年判定（どのクォーターに授業があるか）
      // 1年: 0-3, 2年: 4-7, 3年: 8-11, 4年: 12-15, 5年: 16-19
      let grade = 0;
      for (let g = 0; g < 5; g++) {
        const start = g * 4;
        if (quarters.slice(start, start + 4).some(q => q > 0)) {
          grade = g + 1;
          break;
        }
      }

      // 開講期判定（通年: 0, 前期: 1, 後期: 2）
      // 前期: 1Q, 2Q (偶数インデックス 0,1 / 4,5 など)
      // 後期: 3Q, 4Q (偶数インデックス 2,3 / 6,7 など)
      const gradeStart = (grade - 1) * 4;
      const gradeQuarters = quarters.slice(gradeStart, gradeStart + 4);
      const hasFront = gradeQuarters[0] > 0 || gradeQuarters[1] > 0;
      const hasBack = gradeQuarters[2] > 0 || gradeQuarters[3] > 0;
      let term = 0; // 通年
      if (hasFront && !hasBack) term = 1; // 前期
      else if (!hasFront && hasBack) term = 2; // 後期

      // 担当教員
      const lecturer = cells[26].textContent.trim().replace(/\n/g, '').replace(/ /g, '　').replace(/,/g, '、');

      return {
        divide,
        required,
        title,
        term,
        credit,
        lecturer,
        grade // 学年も保存
      };
    }).filter(x => x !== null);

    // 「海外研修」「留学生」科目を除外
    return subjects.filter(s => !s.title.match(/(海外研修|留学生)/));
  });
}

function saveJSON(filename, object) {
  console.log(`Saving to ${filename}...`);

  const JSONObject = JSON.stringify(object, null, '  ');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSONObject);
}

!(async () => {
  try {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    const year = process.argv[2];
    const courseCode = process.argv[3];

    if (!year || !courseCode) {
      console.log('Usage: node scripts/scrape_syllabus.js <year> <course_code>');
      console.log('Course codes: M, ED, EJ, C, A');
      console.log('Example: node scripts/scrape_syllabus.js 2025 EJ');
      process.exit(1);
    }

    const departmentId = DEPARTMENT_MAP[courseCode];
    if (!departmentId) {
      console.error(`Unknown course code: ${courseCode}`);
      console.log('Available codes: M, ED, EJ, C, A');
      process.exit(1);
    }

    let allSubjects = [];

    // ED/EJ の場合は1-3年を共通ページから取得
    if (courseCode === 'ED' || courseCode === 'EJ') {
      // 1-3年: 電気情報工学科共通ページから取得
      const commonUrl = `https://syllabus.kosen-k.go.jp/Pages/PublicSubjects?school_id=27&department_id=${E_COMMON_DEPARTMENT_ID}&year=${year}&lang=ja`;
      const commonSubjects = await getCurriculumList(page, commonUrl);
      // 1-3年の科目のみ追加
      allSubjects.push(...commonSubjects.filter(s => s.grade >= 1 && s.grade <= 3));
      console.log(`Found ${allSubjects.length} subjects (1-3年)`);

      // 4-5年: 各コースのページから取得
      const courseUrl = `https://syllabus.kosen-k.go.jp/Pages/PublicSubjects?school_id=27&department_id=${departmentId}&year=${year}&lang=ja`;
      const courseSubjects = await getCurriculumList(page, courseUrl);
      // 4-5年の科目のみ追加
      const upperSubjects = courseSubjects.filter(s => s.grade >= 4 && s.grade <= 5);
      allSubjects.push(...upperSubjects);
      console.log(`Found ${upperSubjects.length} subjects (4-5年)`);
    } else {
      // 通常の学科: 1つのページから全学年を取得
      const url = `https://syllabus.kosen-k.go.jp/Pages/PublicSubjects?school_id=27&department_id=${departmentId}&year=${year}&lang=ja`;
      allSubjects = await getCurriculumList(page, url);
    }

    console.log(`Total: ${allSubjects.length} subjects`);

    // 学年ごとに分類
    const byGrade = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    allSubjects.forEach(subject => {
      if (subject.grade >= 1 && subject.grade <= 5) {
        byGrade[subject.grade].push(subject);
      }
    });

    // 各学年のデータを保存（元の形式に合わせてフォーマット）
    for (let grade = 1; grade <= 5; grade++) {
      const subjects = byGrade[grade].map((s, i) => {
        // 元のフォーマット: divide, required, grade, title, term, credit, lecturer, id
        return {
          divide: s.divide,
          required: s.required,
          grade: s.grade,
          title: s.title,
          term: s.term,
          credit: s.credit,
          lecturer: s.lecturer,
          id: i  // 0から始まるid
        };
      });
      saveJSON(`curriculum/${year}/${courseCode}/${grade}.json`, subjects);
    }

    console.log('Done!');
    await browser.close();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
