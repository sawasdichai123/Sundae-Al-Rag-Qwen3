/**
 * Seed Admin User — Run once to create initial admin account
 *
 * Usage:
 *   node scripts/seed-admin.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://bzotgjsbuiuotyknjpfv.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6b3RnanNidWl1b3R5a25qcGZ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTUxNjI5MywiZXhwIjoyMDg3MDkyMjkzfQ.r0rhZnZ7b5sgJEjyQFCPKlnS1rIacbOBLSmWtdOCnTE";

const ADMIN_EMAIL = "admin@sundae.local";
const ADMIN_PASSWORD = "Sundae@2025";

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
    console.log("🚀 Seeding admin account...\n");

    // ── Step 1: Ensure user_profiles table exists ────────────────
    console.log("1️⃣  Checking user_profiles table...");
    const { error: tableCheckError } = await supabaseAdmin
        .from("user_profiles")
        .select("id")
        .limit(1);

    if (tableCheckError && tableCheckError.message.includes("does not exist")) {
        console.log("   ⚠️  Table 'user_profiles' not found. Creating it...\n");

        const { error: sqlError } = await supabaseAdmin.rpc("exec_sql", {
            query: `
                CREATE TABLE IF NOT EXISTS user_profiles (
                    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
                    organization_id UUID,
                    email           TEXT,
                    full_name       TEXT,
                    role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'support', 'admin')),
                    is_approved     BOOLEAN NOT NULL DEFAULT false,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
                CREATE POLICY "Users can read own profile" ON user_profiles FOR SELECT USING (id = auth.uid());
            `,
        });

        if (sqlError) {
            console.log("   ❌ Could not create table via RPC. Please run this SQL manually in Supabase SQL Editor:\n");
            printSQL();
            process.exit(1);
        }
        console.log("   ✅ Table created!\n");
    } else {
        console.log("   ✅ Table exists.\n");
    }

    // ── Step 2: Create auth user ────────────────────────────────
    console.log("2️⃣  Creating auth user...");
    let userId;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        email_confirm: true,
    });

    if (authError) {
        if (authError.message.includes("already been registered")) {
            console.log("   ⚠️  User already exists, looking up...");
            const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
            const existing = users?.find(u => u.email === ADMIN_EMAIL);
            if (existing) {
                userId = existing.id;
                console.log(`   ✅ Found: ${userId}\n`);
            } else {
                console.error("   ❌ Could not find existing user");
                process.exit(1);
            }
        } else {
            console.error("   ❌ Auth error:", authError.message);
            process.exit(1);
        }
    } else {
        userId = authData.user.id;
        console.log(`   ✅ Created: ${userId}\n`);
    }

    // ── Step 3: Upsert user_profiles row ────────────────────────
    console.log("3️⃣  Creating profile...");
    const { error: profileError } = await supabaseAdmin
        .from("user_profiles")
        .upsert({
            id: userId,
            email: ADMIN_EMAIL,
            full_name: "Admin SUNDAE",
            role: "admin",
            is_approved: true,
        }, { onConflict: "id" });

    if (profileError) {
        console.error("   ❌ Profile error:", profileError.message);
        console.log("\n   Please create the table first. SQL:\n");
        printSQL();
        process.exit(1);
    }

    console.log("   ✅ Profile created!\n");
    console.log("═══════════════════════════════════════════════");
    console.log("🎉 Admin account ready!");
    console.log("═══════════════════════════════════════════════");
    console.log(`   📧 Email:    ${ADMIN_EMAIL}`);
    console.log(`   🔑 Password: ${ADMIN_PASSWORD}`);
    console.log(`   👑 Role:     admin`);
    console.log(`   ✅ Approved: true`);
    console.log("═══════════════════════════════════════════════\n");
}

function printSQL() {
    console.log(`-- Run in Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS user_profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID,
    email           TEXT,
    full_name       TEXT,
    role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'support', 'admin')),
    is_approved     BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
    ON user_profiles FOR SELECT USING (id = auth.uid());

CREATE POLICY "Service role full access"
    ON user_profiles FOR ALL
    USING (true) WITH CHECK (true);
`);
}

main().catch(console.error);
