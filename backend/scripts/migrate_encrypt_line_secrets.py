"""
migrate_encrypt_line_secrets.py — One-time migration script

Encrypts all plain-text LINE secrets (line_access_token, line_channel_secret)
in the organizations table using AES-256-GCM.

Run ONCE after setting LINE_ENCRYPTION_KEY in .env:

    cd backend
    python scripts/migrate_encrypt_line_secrets.py

Safe to re-run — already-encrypted values (prefix "enc:") are skipped.
"""

import asyncio
import os
import sys

# Add backend root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(".env")

from app.core.database import init_supabase
from app.core.utils import encrypt_secret


async def main() -> None:
    supabase = await init_supabase()

    print("Fetching organizations with LINE credentials...")
    result = await (
        supabase.table("organizations")
        .select("id, line_access_token, line_channel_secret")
        .execute()
    )

    orgs = result.data or []
    print(f"Found {len(orgs)} organizations.")

    updated = 0
    skipped = 0

    for org in orgs:
        org_id = org["id"]
        access_token = org.get("line_access_token")
        channel_secret = org.get("line_channel_secret")

        # Skip if both are None/empty
        if not access_token and not channel_secret:
            skipped += 1
            continue

        updates: dict = {}

        if access_token and not access_token.startswith("enc:"):
            updates["line_access_token"] = encrypt_secret(access_token)

        if channel_secret and not channel_secret.startswith("enc:"):
            updates["line_channel_secret"] = encrypt_secret(channel_secret)

        if not updates:
            print(f"  [{org_id[:8]}] already encrypted — skip")
            skipped += 1
            continue

        await (
            supabase.table("organizations")
            .update(updates)
            .eq("id", org_id)
        ).execute()

        print(f"  [{org_id[:8]}] encrypted {list(updates.keys())}")
        updated += 1

    print(f"\nDone. Updated: {updated}, Skipped: {skipped}")


if __name__ == "__main__":
    asyncio.run(main())
