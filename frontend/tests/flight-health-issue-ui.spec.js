import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("synthetic hand concern is clickable and stays private to the Flight twin", async ({page}) => {
  const dir = mkdtempSync(join(tmpdir(),"sx-body-issue-"));
  let body;
  try {
    const output = join(dir,"flight.html");
    execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",output],{
      cwd:fileURLToPath(new URL("../../",import.meta.url)),
    });
    body = readFileSync(output,"utf8");
  } finally { rmSync(dir,{recursive:true,force:true}); }
  await page.route(url => url.pathname === "/flight",route => route.fulfill({contentType:"text/html",body}));
  await page.setViewportSize({width:1280,height:800});
  await page.goto("/flight?view=replay");
  await page.getByRole("button",{name:/^Inspect Sana Kepler/}).dispatchEvent("click");
  const marker = page.getByRole("button",{name:"Review synthetic left hand concern for Sana Kepler"});
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(page.locator("#sx-issue-detail")).toBeVisible();
  await expect(page.locator("#sx-issue-detail")).toContainText("Left wrist / hand");
  await expect(page.locator("#sx-issue-detail")).toContainText("not a diagnosis");
  await page.getByRole("button",{name:/^Inspect Ivo Reyes/}).dispatchEvent("click");
  await expect(marker).toBeHidden();
  await expect(page.locator("#sx-issue-detail")).toBeHidden();
});

test("the avatar strip does not cover Flight playback on a judge laptop", async ({page}) => {
  const dir = mkdtempSync(join(tmpdir(),"sx-portrait-layout-"));
  let body;
  try {
    const output = join(dir,"flight.html");
    execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",output],{
      cwd:fileURLToPath(new URL("../../",import.meta.url)),
    });
    body = readFileSync(output,"utf8");
  } finally {rmSync(dir,{recursive:true,force:true});}
  await page.route(url => url.pathname === "/flight",route => route.fulfill({contentType:"text/html",body}));
  await page.setViewportSize({width:1280,height:800});
  await page.goto("/flight?view=replay");
  const strip = page.locator("#crew-strip");
  const controls = page.locator("#flight-playback");
  await expect(strip).toBeVisible();
  const overlap = await page.evaluate(() => {
    const a=document.getElementById("crew-strip").getBoundingClientRect();
    const b=document.getElementById("flight-playback").getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  expect(overlap).toBe(false);
});

test("training body markers follow the reported body region instead of staying on the hand", async ({page}) => {
  const dir=mkdtempSync(join(tmpdir(),"sx-multi-region-"));
  let body;
  try {
    const output=join(dir,"flight.html");
    execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",output],{
      cwd:fileURLToPath(new URL("../../",import.meta.url)),
    });
    body=readFileSync(output,"utf8");
  } finally {rmSync(dir,{recursive:true,force:true});}
  await page.route(url => url.pathname==="/flight",route=>route.fulfill({contentType:"text/html",body}));
  await page.goto("/flight?view=replay");
  await page.getByRole("button",{name:/^Inspect Mara Vale/}).dispatchEvent("click");
  await page.getByRole("combobox",{name:"Choose body concern example"}).selectOption("chest");
  const marker=page.locator("#sx-left-hand-marker");
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute("data-region","torso");
  await marker.click();
  await expect(page.locator("#sx-issue-detail")).toContainText("Chest-pain emergency");
  await page.getByRole("combobox",{name:"Choose body concern example"}).selectOption("head");
  await expect(marker).toHaveAttribute("data-region","head");
  await marker.click();
  await expect(page.locator("#sx-issue-detail")).toContainText("Dizziness");
  await page.getByRole("combobox",{name:"Choose body concern example"}).selectOption("leg");
  await expect(marker).toHaveAttribute("data-region","right-leg");
  await marker.click();
  await expect(page.locator("#sx-issue-detail")).toContainText("Right-leg discomfort");
});

test("mission audio has an explicit accessible mute control", async ({page}) => {
  const dir=mkdtempSync(join(tmpdir(),"sx-audio-toggle-"));
  let body;
  try {
    const output=join(dir,"flight.html");
    execFileSync(process.env.SX_TEST_PYTHON || "python3",["scripts/build_flight_canvas.py",output],{
      cwd:fileURLToPath(new URL("../../",import.meta.url)),
    });
    body=readFileSync(output,"utf8");
  } finally {rmSync(dir,{recursive:true,force:true});}
  await page.route(url=>url.pathname==="/flight",route=>route.fulfill({contentType:"text/html",body}));
  await page.goto("/flight?view=replay");
  const toggle=page.getByRole("button",{name:"Mute mission sound effects"});
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole("button",{name:"Enable mission sound effects"})).toHaveAttribute("aria-pressed","false");
  await page.getByRole("button",{name:"Enable mission sound effects"}).click();
  await expect(page.getByRole("button",{name:"Mute mission sound effects"})).toHaveAttribute("aria-pressed","true");
});
