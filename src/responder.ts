import * as puppeteer from "puppeteer";
import {LinkInfos, loadLinkInfos} from "./common.js";
import fs from "fs/promises";
import config from "./config.js";

const browser = await puppeteer.launch({
    headless: false, defaultViewport: null, args: [ '--start-maximized'],
});

let page = (await browser.pages())[0];
let contentHtml = await fs.readFile('src/responder.html', {encoding: 'utf8'});

await page.setContent(contentHtml, {waitUntil: "load"});
await page.addStyleTag({path: 'src/responder-page.css'})
let linkInfos = await loadLinkInfos();

let responses = [];
for (let i = 1; i <= 5; i++) {
    responses.push((await fs.readFile('src/responses/'+i+'-person.txt')).toString());
}


page.exposeFunction('saveData', (newLinkInfos: LinkInfos)=>{
    console.log('Saving linkInfos...')
    fs.writeFile('data.json', JSON.stringify(newLinkInfos))
})

page.exposeFunction('excludeLink', async (link: string) => {
    fs.writeFile('excludedLinks.txt', (await fs.readFile('excludedLinks.txt')).toString('utf8').trim()+ '\n' + link);
})

page.evaluate((linkInfos: LinkInfos, config: any, responses: string[]) => {

    let links = Object.keys(linkInfos).filter(l => linkInfos[l].suitable && linkInfos[l]);

    document.dispatchEvent(new CustomEvent("startApp", {detail: {linkInfos, config, responses}}))

}, linkInfos as any, config, responses);
