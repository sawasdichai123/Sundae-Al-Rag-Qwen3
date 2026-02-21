/**
 * SUNDAE Human Handoff — E2E Tests (Optimized)
 *
 * Design:
 *   - test.describe.serial() = ทุก test ใช้ page เดียวกัน ไม่ต้อง login ซ้ำ
 *   - LLM call เกิดขึ้นแค่ครั้งเดียวใน test แรก (SETUP)
 *   - test ที่เหลือ reuse handoff session ที่สร้างไว้แล้ว
 *   - ใช้ getByText() แทน text="..." เพื่อรองรับ Thai + Unicode ได้ดีกว่า
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

// ─── Shared state across serial tests ───────────────────────
let sharedPage: Page;

test.describe.serial('SUNDAE Human Handoff E2E Tests', () => {

    // ─── Login once, reuse across all tests ──────────────────
    test.beforeAll(async ({ browser }) => {
        sharedPage = await browser.newPage();
        await sharedPage.goto(`${BASE_URL}/login`);
        await sharedPage.fill('input[type="email"]', 'admin@sundae.local');
        await sharedPage.fill('input[type="password"]', 'Sundae@2025');
        await sharedPage.click('button[type="submit"]');
        await sharedPage.waitForURL('**/', { timeout: 20_000 });
        await expect(sharedPage.locator('nav').getByText('Inbox')).toBeVisible({ timeout: 20_000 });
    });

    test.afterAll(async () => {
        await sharedPage.close();
    });

    // ═════════════════════════════════════════════════════════
    // H1: ปุ่ม Handoff ไม่แสดงตอนแชทว่าง
    // ═════════════════════════════════════════════════════════

    test('H1: ปุ่ม Handoff ไม่แสดงตอนแชทว่าง', async () => {
        await sharedPage.locator('nav').getByText('Web Chat').click();
        await sharedPage.waitForURL('**/chat');
        await sharedPage.waitForTimeout(1000);

        await expect(sharedPage.getByText('ขอพูดคุยกับเจ้าหน้าที่')).not.toBeVisible();
    });

    // ═════════════════════════════════════════════════════════
    // H2-H3: ส่งข้อความ → รอ Bot → กดขอเจ้าหน้าที่
    //   (LLM call เกิดขึ้นที่นี่ครั้งเดียว)
    // ═════════════════════════════════════════════════════════

    test('H2-H3: พิมพ์ข้อความ → กดขอเจ้าหน้าที่ → เห็น system msg + banner', async () => {
        test.setTimeout(180_000);

        if (!sharedPage.url().includes('/chat')) {
            await sharedPage.locator('nav').getByText('Web Chat').click();
            await sharedPage.waitForURL('**/chat');
            await sharedPage.waitForTimeout(1000);
        }

        // H2: พิมพ์ข้อความ
        const textarea = sharedPage.locator('textarea');
        await textarea.fill('สวัสดี ขอถามข้อมูลหน่อย');
        await textarea.press('Enter');

        // รอ Bot ตอบกลับ — ปุ่ม Handoff ปรากฏเมื่อ isLoading=false
        const handoffBtn = sharedPage.getByText('ขอพูดคุยกับเจ้าหน้าที่');
        await expect(handoffBtn).toBeVisible({ timeout: 150_000 });

        // H3: กดปุ่มขอเจ้าหน้าที่
        await handoffBtn.click();

        // เห็น system message
        await expect(sharedPage.getByText('กำลังเรียกเจ้าหน้าที่')).toBeVisible({ timeout: 10_000 });

        // ปุ่ม Handoff หายไป
        await expect(handoffBtn).not.toBeVisible();

        // เห็น banner สีฟ้า (ใช้ CSS selector เพราะเสถียรกว่า)
        await expect(sharedPage.locator('.bg-blue-50.border-blue-200')).toBeVisible({ timeout: 10_000 });
    });

    // ═════════════════════════════════════════════════════════
    // H4: User พิมพ์ข้อความได้ระหว่างรอเจ้าหน้าที่
    // ═════════════════════════════════════════════════════════

    test('H4: User พิมพ์ข้อความได้ระหว่าง Handoff', async () => {
        const textarea = sharedPage.locator('textarea');
        await expect(textarea).toBeEnabled();

        // placeholder เปลี่ยน
        await expect(textarea).toHaveAttribute('placeholder', 'พิมพ์ข้อความถึงเจ้าหน้าที่...');

        // ส่งข้อความได้
        await textarea.fill('ช่วยเรื่องนี้หน่อยครับ');
        await textarea.press('Enter');

        // เห็นข้อความที่ส่งในแชท
        await expect(sharedPage.getByText('ช่วยเรื่องนี้หน่อยครับ')).toBeVisible({ timeout: 5000 });
    });

    // ═════════════════════════════════════════════════════════
    // I1-I2: Inbox เห็นเซสชัน Handoff + system message
    // ═════════════════════════════════════════════════════════

    test('I1-I2: Inbox เห็นเซสชัน Handoff + system message', async () => {
        // WebChat is full-screen (no sidebar nav), so navigate directly
        await sharedPage.goto(`${BASE_URL}/inbox`);
        await sharedPage.waitForURL('**/inbox');
        await sharedPage.waitForTimeout(2000);

        // I1: เห็น badge "รับเรื่อง"
        await expect(sharedPage.getByText('รับเรื่อง').first()).toBeVisible({ timeout: 10_000 });

        // คลิกเซสชันแรก
        const firstSession = sharedPage.locator('button.w-full.text-left').first();
        await firstSession.click();
        await sharedPage.waitForTimeout(1000);

        // I2: เห็น system message
        await expect(sharedPage.getByText('ผู้ใช้ขอพูดคุยกับเจ้าหน้าที่')).toBeVisible({ timeout: 10_000 });
    });

    // ═════════════════════════════════════════════════════════
    // I3-I4: Admin Reply Composer + ส่งข้อความ
    // ═════════════════════════════════════════════════════════

    test('I3-I4: Admin Reply Composer + ส่งข้อความ', async () => {
        // I3: เห็น Admin Reply Composer
        const replyTextarea = sharedPage.locator('textarea[placeholder*="พิมพ์ข้อความตอบกลับ"]');
        await expect(replyTextarea).toBeVisible({ timeout: 5000 });

        // I4: พิมพ์และส่งข้อความ
        await replyTextarea.fill('สวัสดีครับ ผมมาช่วยคุณ');
        await replyTextarea.press('Enter');

        // เห็นข้อความ Admin
        await expect(sharedPage.getByText('สวัสดีครับ ผมมาช่วยคุณ')).toBeVisible({ timeout: 5000 });

        // เห็นป้าย "เจ้าหน้าที่" + Avatar "A" สีน้ำเงิน
        await expect(sharedPage.locator('.bg-blue-500').filter({ hasText: 'A' }).first()).toBeVisible();
    });

    // ═════════════════════════════════════════════════════════
    // K1-K3: Status Transitions
    // ═════════════════════════════════════════════════════════

    test('K1-K3: เปลี่ยน status — คืนร่างให้ AI → ปิดเคส → เปิดใหม่', async () => {
        // K1: คืนร่างให้ AI
        await sharedPage.getByText('คืนร่างให้ AI').click();
        await sharedPage.waitForTimeout(1500);

        // reply composer หายไป
        await expect(sharedPage.locator('textarea[placeholder*="พิมพ์ข้อความตอบกลับ"]')).not.toBeVisible();

        // K2: ปิดเคส
        await sharedPage.getByText('ปิดเคส').click();
        await sharedPage.waitForTimeout(1500);

        // เห็นปุ่ม "เปิดใหม่"
        await expect(sharedPage.getByText('เปิดใหม่')).toBeVisible();

        // K3: เปิดใหม่
        await sharedPage.getByText('เปิดใหม่').click();
        await sharedPage.waitForTimeout(1500);

        // เห็นปุ่ม "รับเรื่อง" อีกครั้ง
        await expect(sharedPage.getByText('รับเรื่อง').last()).toBeVisible();
    });

    // ═════════════════════════════════════════════════════════
    // L1: Active session ไม่มี Admin Reply Composer
    // ═════════════════════════════════════════════════════════

    test('L1: Active session ไม่มี Admin Reply Composer', async () => {
        await expect(sharedPage.locator('textarea[placeholder*="พิมพ์ข้อความตอบกลับ"]')).not.toBeVisible();
    });

    // ═════════════════════════════════════════════════════════
    // M1: Message Styling
    // ═════════════════════════════════════════════════════════

    test('M1: ตรวจสอบ styling ข้อความทุกประเภท', async () => {
        // User message: bg-steel-800
        await expect(sharedPage.locator('.bg-steel-800').first()).toBeVisible();

        // Bot avatar "S": bg-brand-400
        await expect(sharedPage.locator('.bg-brand-400').filter({ hasText: 'S' }).first()).toBeVisible();

        // System message: bg-amber-50
        await expect(sharedPage.locator('.bg-amber-50').first()).toBeVisible();

        // Admin message: bg-blue-50 + avatar "A" bg-blue-500
        await expect(sharedPage.locator('.bg-blue-50').first()).toBeVisible();
        await expect(sharedPage.locator('.bg-blue-500').filter({ hasText: 'A' }).first()).toBeVisible();
    });
});
