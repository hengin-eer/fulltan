#!/bin/bash
# ./scripts/scrape.sh [year]

year=${1:-2025}

echo "Scraping curriculum data for year: $year"

node scripts/scrape_mcc.js $year

echo "All done!"
