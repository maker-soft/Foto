#!/usr/bin/env python3
"""
Export aggregated Yandex Metrica analytics to JSON/CSV files.

Requires:
  YANDEX_METRIKA_TOKEN
Optional:
  YANDEX_METRIKA_COUNTER_ID (default: 111851028)
  METRIKA_DAYS (default: 90)
  METRIKA_OUTPUT_DIR (default: yandex-metrica-export)
"""

from __future__ import annotations

import csv
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_BASE = "https://api-metrika.yandex.net"
COUNTER_ID = os.getenv("YANDEX_METRIKA_COUNTER_ID", "111851028").strip()
TOKEN = os.getenv("YANDEX_METRIKA_TOKEN", "").strip()
DAYS = int(os.getenv("METRIKA_DAYS", "90"))
OUTPUT_DIR = Path(os.getenv("METRIKA_OUTPUT_DIR", "yandex-metrica-export"))

COMMON_METRICS = [
    "ym:s:visits",
    "ym:s:users",
    "ym:s:pageviews",
    "ym:s:bounceRate",
    "ym:s:pageDepth",
    "ym:s:avgVisitDurationSeconds",
]

REPORTS = [
    {
        "name": "daily",
        "dimensions": ["ym:s:date"],
        "metrics": COMMON_METRICS,
        "sort": "ym:s:date",
    },
    {
        "name": "traffic_sources",
        "dimensions": ["ym:s:trafficSource"],
        "metrics": COMMON_METRICS,
        "sort": "-ym:s:visits",
    },
    {
        "name": "search_engines",
        "dimensions": ["ym:s:searchEngine"],
        "metrics": COMMON_METRICS,
        "filters": "ym:s:trafficSource=='organic'",
        "sort": "-ym:s:visits",
    },
    {
        "name": "landing_pages",
        "dimensions": ["ym:s:startURL"],
        "metrics": COMMON_METRICS,
        "sort": "-ym:s:visits",
    },
    {
        "name": "devices",
        "dimensions": ["ym:s:deviceCategory"],
        "metrics": COMMON_METRICS,
        "sort": "-ym:s:visits",
    },
    {
        "name": "geography",
        "dimensions": ["ym:s:regionCountry", "ym:s:regionCity"],
        "metrics": ["ym:s:visits", "ym:s:users", "ym:s:bounceRate"],
        "sort": "-ym:s:visits",
    },
    {
        "name": "browsers",
        "dimensions": ["ym:s:browser"],
        "metrics": ["ym:s:visits", "ym:s:users", "ym:s:bounceRate"],
        "sort": "-ym:s:visits",
    },
    {
        "name": "conversions",
        "dimensions": ["ym:s:goal"],
        "metrics": [
            "ym:s:visits",
            "ym:s:users",
            "ym:s:anyGoalReaches",
            "ym:s:anyGoalConversionRate",
        ],
        "sort": "-ym:s:anyGoalReaches",
    },
    {
        "name": "popular_pages",
        "dimensions": ["ym:pv:URL"],
        "metrics": ["ym:pv:pageviews", "ym:pv:users"],
        "sort": "-ym:pv:pageviews",
    },
]


class MetricaError(RuntimeError):
    pass


def api_get(path: str, params: dict[str, Any] | None = None, retries: int = 3) -> dict[str, Any]:
    url = f"{API_BASE}{path}"
    if params:
        query = urlencode({k: v for k, v in params.items() if v is not None})
        url = f"{url}?{query}"

    request = Request(
        url,
        headers={
            "Authorization": f"OAuth {TOKEN}",
            "Accept": "application/json",
            "User-Agent": "photobook-nsk-metrica-export/1.0",
        },
        method="GET",
    )

    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if exc.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(2 ** (attempt - 1))
                last_error = exc
                continue
            raise MetricaError(f"HTTP {exc.code} for {path}: {body[:1000]}") from exc
        except URLError as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(2 ** (attempt - 1))
                continue
            raise MetricaError(f"Network error for {path}: {exc}") from exc

    raise MetricaError(f"Failed request for {path}: {last_error}")


def dimension_value(obj: Any) -> str:
    if isinstance(obj, dict):
        value = obj.get("name")
        if value is None:
            value = obj.get("id", "")
        return str(value)
    if obj is None:
        return ""
    return str(obj)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False),
        encoding="utf-8",
    )


def write_report_csv(
    path: Path,
    payload: dict[str, Any],
    dimensions: list[str],
    metrics: list[str],
) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(dimensions + metrics)

        for row in payload.get("data", []):
            dim_values = [dimension_value(x) for x in row.get("dimensions", [])]
            metric_values = row.get("metrics", [])
            writer.writerow(dim_values + metric_values)


def export_report(
    date1: str,
    date2: str,
    definition: dict[str, Any],
) -> dict[str, Any]:
    dimensions = definition["dimensions"]
    metrics = definition["metrics"]
    params = {
        "ids": COUNTER_ID,
        "date1": date1,
        "date2": date2,
        "dimensions": ",".join(dimensions),
        "metrics": ",".join(metrics),
        "accuracy": "full",
        "limit": "100000",
        "lang": "ru",
        "include_undefined": "true",
        "sort": definition.get("sort"),
        "filters": definition.get("filters"),
    }
    return api_get("/stat/v1/data", params)


def main() -> int:
    if not TOKEN:
        print("ERROR: GitHub secret YANDEX_METRIKA_TOKEN is not configured.", file=sys.stderr)
        return 2

    if not COUNTER_ID.isdigit():
        print("ERROR: YANDEX_METRIKA_COUNTER_ID must be numeric.", file=sys.stderr)
        return 2

    if DAYS < 1 or DAYS > 366:
        print("ERROR: METRIKA_DAYS must be between 1 and 366.", file=sys.stderr)
        return 2

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    end_date = date.today()
    start_date = end_date - timedelta(days=DAYS - 1)
    date1 = start_date.isoformat()
    date2 = end_date.isoformat()

    # Fail fast on token/counter access before running report set.
    counter_payload = api_get(f"/management/v1/counter/{COUNTER_ID}")
    counter = counter_payload.get("counter", counter_payload)

    goals_payload = api_get(f"/management/v1/counter/{COUNTER_ID}/goals")
    goals = goals_payload.get("goals", [])

    write_json(OUTPUT_DIR / "counter.json", counter_payload)
    write_json(OUTPUT_DIR / "goals.json", goals_payload)

    # Whole-period headline totals.
    summary_payload = api_get(
        "/stat/v1/data",
        {
            "ids": COUNTER_ID,
            "date1": date1,
            "date2": date2,
            "metrics": ",".join(COMMON_METRICS),
            "accuracy": "full",
            "lang": "ru",
        },
    )
    write_json(OUTPUT_DIR / "summary.json", summary_payload)

    manifest: dict[str, Any] = {
        "exported_at_utc": datetime.now(timezone.utc).isoformat(),
        "counter_id": COUNTER_ID,
        "counter_name": counter.get("name"),
        "site": counter.get("site"),
        "permission": counter.get("permission"),
        "period": {"date1": date1, "date2": date2, "days": DAYS},
        "goal_count": len(goals),
        "reports": [],
    }

    failures = 0
    for definition in REPORTS:
        name = definition["name"]
        print(f"Exporting {name}...")
        try:
            payload = export_report(date1, date2, definition)
            write_json(OUTPUT_DIR / f"{name}.json", payload)
            write_report_csv(
                OUTPUT_DIR / f"{name}.csv",
                payload,
                definition["dimensions"],
                definition["metrics"],
            )
            manifest["reports"].append(
                {
                    "name": name,
                    "status": "ok",
                    "rows": len(payload.get("data", [])),
                    "total_rows": payload.get("total_rows"),
                    "sampled": payload.get("sampled"),
                    "sample_share": payload.get("sample_share"),
                    "contains_sensitive_data": payload.get("contains_sensitive_data"),
                }
            )
        except Exception as exc:
            failures += 1
            error = str(exc)
            print(f"WARNING: {name} failed: {error}", file=sys.stderr)
            write_json(OUTPUT_DIR / f"{name}.error.json", {"error": error})
            manifest["reports"].append(
                {"name": name, "status": "error", "error": error}
            )

    write_json(OUTPUT_DIR / "manifest.json", manifest)

    readme = f"""Yandex Metrica export
======================

Counter: {COUNTER_ID}
Site: {counter.get('site') or ''}
Period: {date1} .. {date2}
Generated (UTC): {manifest['exported_at_utc']}

This archive contains aggregated reports only.
The OAuth token is never written to the archive.

Successful reports: {sum(1 for r in manifest['reports'] if r['status'] == 'ok')}
Failed optional reports: {failures}
"""
    (OUTPUT_DIR / "README.txt").write_text(readme, encoding="utf-8")

    # Optional report failures do not block delivery of the successful reports.
    print(f"Done. Exported to {OUTPUT_DIR}. Optional report failures: {failures}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
