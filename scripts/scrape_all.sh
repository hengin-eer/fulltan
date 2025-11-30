#!/bin/bash
# 高専Webシラバスから全学科のカリキュラムをスクレイピングするスクリプト
# 使用方法: ./scripts/scrape_all.sh [year]
# 例: ./scripts/scrape_all.sh 2025

year=${1:-2025}

echo "Scraping curriculum data for year: $year"

# 各学科をスクレイピング
node scripts/scrape_syllabus.js $year M    # 機械工学科
node scripts/scrape_syllabus.js $year ED   # 電気情報工学科（電気電子工学コース）
node scripts/scrape_syllabus.js $year EJ   # 電気情報工学科（情報工学コース）
node scripts/scrape_syllabus.js $year C    # 都市システム工学科
node scripts/scrape_syllabus.js $year A    # 建築学科

echo "All done!"
