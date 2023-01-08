import * as puppeteer from "puppeteer";
import {Browser, Page} from "puppeteer";
import chalk from "chalk";
import assert from "assert";
import fs from "fs/promises";
import {ConcerningMatch, LinkInfo, loadLinkInfos} from "./common.js";

import config from './config.js';

async function closeNewsletterModal(page: Page) {
    let intervalID = 0;
    if (await page.$("#newsletter-modal")) { // close modal
        intervalID = setInterval(async _ => {
            if (await page.$eval("#newsletter-modal", (el: any | HTMLSpanElement) => {
                if (el.style.display != "none") {
                    setTimeout(() => {
                        el.querySelector(".mod-close").click();
                    }, 2500);
                    return true
                }
                return false;
            })) {
                clearInterval(intervalID);
            }
        }, 100);
    }
}


assert.deepEqual(interval(0, 0), []);
assert.deepEqual(interval(0, 1), [0]);
assert.deepEqual(interval(1, 2), [1]);
assert.deepEqual(interval(2, 2), []);
assert.deepEqual(interval(1, 5), [1, 2, 3, 4])

function interval(start: number, end: number) {
    return Array(end - start).fill(0).map((v, i) => i + start);
}

async function scanLinks(links: string[], linkInfos: { [name: string]: LinkInfo }, pageNum: number, currentMaxDistance: number, city: string, excludedLinks: Set<string>, browser: Browser, page?: Page) {
    console.log(chalk.yellow("[INFO]: ") + "Scanning page " + pageNum);

    if (!page) {
        console.log(chalk.gray("\tOpening new page"))
        page = await browser.newPage();
        await page.goto("https://huurstunt.nl/huren/" +
            urlify(city) + "/" +
            (currentMaxDistance ? "+" + currentMaxDistance + "km/" : '') +
            "p" + pageNum + "/", {waitUntil: "networkidle0", timeout: 3 * 60 * 1000});

    }


    await closeNewsletterModal(page);

    let pageLinks = [...await page.$$eval(".search-results a", elements =>
        elements
            .filter(a => a.querySelector(".property-type.property--red") === null)// filter out "rented"
            .filter(a => a.querySelector(".property-type.property--orange") === null)// filter out "under option"
            .map(a => a.getAttribute("href"))
            .filter(link => link?.startsWith("/appartement/huren/"))) as any as string[]];


    // checks if the link has been added
    for (const link of pageLinks) {
        if (linkInfos[link]) {
            //console.log("We already have info about " + link);
            continue
        }
        if (excludedLinks.has(link)) {
            //console.log("Excluded link, skipping" + link);
            continue;
        }
        linkInfos[link] = {distance: currentMaxDistance, hasDetails: false};
        notifyChangedLinkInfo();

        links.push(link);
    }
    if (pageNum !== 1) {
        await page.close();
    }
}

function saveExcludedLinks(excludedLinks: Set<string>) {
    console.log("Saving excluded links")
    return fs.writeFile("excludedLinks.txt", Array.from(excludedLinks).join('\n'))
}

let changedLinkInfo = false;

function notifyChangedLinkInfo() {
    changedLinkInfo = true;
}

async function saveLinkInfo(linkInfo: { [name: string]: LinkInfo }) {
    await fs.writeFile("data.json", JSON.stringify(linkInfo, null, 2));
    changedLinkInfo = false;
}

function saveSometimes(excludedLinks: Set<string>, linkInfo: { [name: string]: LinkInfo }, interval: number = 10000) {
    let ELCount = excludedLinks.size;
    setInterval(() => {
        if (ELCount != excludedLinks.size) {
            saveExcludedLinks(excludedLinks).then(_ => {
                ELCount = excludedLinks.size;
            })
        }
        if (changedLinkInfo) {
            saveLinkInfo(linkInfo);
        }
    }, interval);
}


let refreshContactDetails = false;
const sentenceSeparators = ['.', '!', '?', ':', ';', '-', '\n'];

function concerningTexts(description: string) {

    let concerningMatches: ConcerningMatch[] = [];
    ['student', 'sharer', 'deler', 'couple'].forEach(concerningWord => {
        [...description.matchAll(new RegExp(concerningWord, 'gi'))].forEach(m => {
            assert(m.index !== undefined, "Match index shouldn't be undefined.");
            concerningMatches.push({index: m.index, concerningText: m[0]})
        });
    })
    concerningMatches.forEach(concerningMatch => {
        let startIndex = concerningMatch.index;
        while (startIndex > 0 && !sentenceSeparators.includes(description.charAt(startIndex))) {
            startIndex--;
        }
        while (sentenceSeparators.includes(description.charAt(startIndex)) || ['\n', ' '].includes(description.charAt(startIndex))) startIndex++;
        let endIndex = startIndex + 1;
        while (endIndex < description.length && !sentenceSeparators.includes(description.charAt(endIndex))) {
            endIndex++;
        }
        concerningMatch.concerningSentence = description.substring(startIndex, endIndex);
        concerningMatch.index -= startIndex;
    })

    return concerningMatches;
}

//concerningTexts("studentEgy kettő három négy. hat hét nyolc : Öt hart student nyolc- kilenc tíz sharer,deler,.-deler")

async function main() {

    let links: string[] = [];


    let excludedLinks = new Set<string>();
    try {
        await fs.access("excludedLinks.txt");
        let result = await fs.readFile("excludedLinks.txt");

        result.toString().split('\n').forEach(v => v && excludedLinks.add(v));
    } catch (e) {
        console.log("[INFO]: excluded links not found", e)
    }

    let linkInfos: { [name: string]: LinkInfo } = await loadLinkInfos();

    saveSometimes(excludedLinks, linkInfos);


    const browser = await puppeteer.launch({
        headless: false, defaultViewport: null, args: ['--start-maximized', '--disable-dev-shm-usage'],
    });

    const page = (await browser.pages())[0]; // there is already an open tab

    await page.goto("https://huurstunt.nl", {waitUntil: "networkidle0"});
    await page.click(".cc-btn.cc-allow"); // allow cookies
    await page.click("a.login"); // press login btn

    await delay(500);

    console.log(chalk.yellow("[INFO]: ") + "Logging in...");
    await page.type("#login_form_userName", config.EMAIL);
    await page.type("#login_form_userPass", config.PASSWORD);
    await page.click("form button.btn-lg");

    await page.waitForNavigation({waitUntil: "load"})


    let suitableAds = [];

    // COLLECTING LINKS

    for (const place of config.PLACES) {
        console.log(`${chalk.yellow("\n[INFO]: ")}Collecting links for ${place.city}...`);

        for (let currentMaxDistance = 0; currentMaxDistance <= place.maxDistanceKm; currentMaxDistance++) {
            let pageCount = 1;

            await page.goto("https://huurstunt.nl/huren/" +
                urlify(place.city) + "/" +
                (currentMaxDistance ? "+" + currentMaxDistance + "km/" : ''), {waitUntil: "networkidle0"});


            console.log(chalk.blue("-----------[ ") + "Distance Radius: " + currentMaxDistance + "km " + chalk.blue("]-----------"))
            if (await page.$('.pagination-bar ul')) {
                pageCount = await page.$$eval('.pagination-bar ul.pagination li', (elements: any | HTMLLIElement) => {
                    return +elements[Math.max(0, elements.length - 2)].innerText
                }) as any as number;
            }

            console.log("[INFO]: page count = " + pageCount)
            await scanLinks(links, linkInfos, 1, currentMaxDistance, place.city, excludedLinks, browser, page);


            let chunkSize = 3;
            for (let si = 2; si < Math.min(3,pageCount + 1); si += chunkSize) {
                await Promise.all(interval(si, Math.min(pageCount + 1, si + chunkSize)).map(i => {
                    return scanLinks(links, linkInfos, i, currentMaxDistance, place.city, excludedLinks, browser);
                }));
            }

        }

        for (const link of links) {
            assert(linkInfos[link] !== undefined && linkInfos[link].distance !== undefined, link);
        }
    }

    for (const link of Object.keys(linkInfos)) {
        if (!excludedLinks.has(link)) {
            if (links.indexOf(link) === -1) {
                links.push(link);
            }
        } else {
            delete linkInfos[link];
            notifyChangedLinkInfo();
        }
    }

    // CHECKING ADVERTS
    console.log("Checking adverts...")
    for (let link of links) {
        console.log(chalk.yellow("[AD]: ") + "https://huurstunt.nl" + link)
        if (linkInfos[link].hasDetails && !refreshContactDetails) {
            console.log(chalk.grey("\tWe already have details, skipping."))
            continue;
        }
        const adPage = await browser.newPage();

        await adPage.goto("https://huurstunt.nl" + link, {waitUntil: "domcontentloaded"});

        if (await adPage.$('.rental-not-found')) {
            console.log(chalk.red("\t[ERROR]: RENTAL NOT FOUND"))
            await adPage.close()
            excludedLinks.add(link);
            delete linkInfos[link];
            notifyChangedLinkInfo();
            continue;
        }

        let linkInfo = linkInfos[link];

        let description = await adPage.$eval('.rental-description .block-body', el => (el as HTMLDivElement).innerText) as any as string;

        if (linkInfo.bedroomCount === undefined) {
            linkInfo.bedroomCount = await adPage.$$eval(".rental-characteristics-long div.row", (elements: (HTMLDivElement | any)[]) => {
                for (let element of elements) {
                    if (element.innerText?.startsWith("Aantal slaapkamers:")) {
                        return +element.querySelector(":nth-child(2)").innerText || 0;
                    }
                }
                return 0;
            }) as any as number;
        }

        // todo search in description too
        // TODO 1 BEDROOM when the description mentions it without numbers


        // todo add to exceptional houses when they are not equal
        if (linkInfo.peopleCount === undefined) {
            linkInfo.peopleCount = Math.min(
                linkInfo.bedroomCount || Infinity,
                ...([...description.matchAll(/(\d)\sperson[^a-zA-Z]+/g)].map(res => res[1]) as any as number[]),
                ...([...description.matchAll(/(\d)\spersons[^a-zA-Z]+/g)].map(res => res[1]) as any as number[]),
                ...([...description.matchAll(/(\d)\speople[^a-zA-Z]+/g)].map(res => res[1]) as any as number[]),
                ...([...description.matchAll(/(\d)\spersoon[^a-zA-Z]+/g)].map(res => res[1]) as any as number[]),
                ...([...description.matchAll(/(\d)\spersonen[^a-zA-Z]+/g)].map(res => res[1]) as any as number[])
            );
        }

        let priceS = await adPage.$eval('.price h2', element => element.innerHTML.match(/€\s*([\d.]+)/)![1]) as any as string;
        linkInfo.price = +String(priceS).replace(/\./g, '');
        linkInfo.roomPrice = linkInfo.price / linkInfo.peopleCount;
        linkInfo.hasDetails = true
        linkInfo.responded ||= false

        linkInfo.title ||= (await adPage.$eval('.rental-header .title__listing', (el: any) => el.innerText)).trim()

        if (await adPage.$('.agent__info__mail__show a')) {
            linkInfo.email ||= await adPage.$eval('.agent__info__mail__show a', (el: any) => el.innerText.trim());
        }

        notifyChangedLinkInfo();

        console.log("\tPrice: € " + linkInfo.price)
        console.log("\tGroup size: ", linkInfo.peopleCount)
        console.log("\tPrice per person: € " + linkInfo.roomPrice);

        // todo cache sent urls, optionally the excluded ads based on student status or price - price could change, don't cache that

        if (prefixPostfixSearch(config.BLACKLIST_PREFIXES, config.BLACKLIST_POSTFIXES, description.toLowerCase())) {
            console.log(chalk.red("\tROOM NOT SUITABLE FOR HOME SHARERS/STUDENTS")); // todo check for students and sharers separately
            //console.log(chalk.yellow("[DESCRIPTION]:"));
            //console.log(chalk.grey(description));
            excludedLinks.add(link); // EXCLUDE IT FROM FUTURE SEARCHES
            delete linkInfos[link];
            notifyChangedLinkInfo();
            await adPage.close();
            continue;
        }


        linkInfo.concerningTexts ||= concerningTexts(description);

        if (linkInfo.roomPrice > config.MAX_ROOM_PRICE) {
            await adPage.close();
            console.log(chalk.red("\tROOM TOO EXPENSIVE"))
            linkInfo.suitable = false;
            notifyChangedLinkInfo();
            continue;
        }

        linkInfo.suitable = true;
        notifyChangedLinkInfo();
        console.log(chalk.green("\tSuitable apartment"))

        /* await adPage.addStyleTag({path: "src/ad-page.css"})
         await adPage.evaluate((linkInfo: LinkInfo) => {
             let container = document.createElement("div") as HTMLDivElement;
             container.classList.add("huurstunt-bot");
             document.body.append(container);

             let adInfoCont = document.createElement("div") as HTMLDivElement;
             adInfoCont.id = "ad-info-cont";
             container.append(adInfoCont);

             function createDiv(content: string | any) {
                 let el = document.createElement("div");
                 el.innerText = content;
                 return el;
             }

             adInfoCont.append(createDiv("Room Price:"))
             adInfoCont.append(createDiv("€ " + Math.round(linkInfo.roomPrice!)))
             if (linkInfo.peopleCount !== linkInfo.bedroomCount) {
                 adInfoCont.append(createDiv("Bedroom Count:"))
                 adInfoCont.append(createDiv(linkInfo.bedroomCount));
             }
             adInfoCont.append(createDiv("Max People:"))
             adInfoCont.append(createDiv(linkInfo.peopleCount));

             adInfoCont.append(createDiv(`Distance:`))
             adInfoCont.append(createDiv(`+${linkInfo.distance}km`))

         }, linkInfo as any);
 */
        await adPage.close();

    }


    console.log(chalk.green('\nFINISHED SCANNING!'))

}

main();


// unit tests xd
assert(!prefixPostfixSearch(['no ', 'geen '], ['students', 'home sharers', "sharers"], ' adasda d ad da no fafasdfsd nowqfw '))
assert(!prefixPostfixSearch(['no ', 'geen '], ['students', 'home sharers', "sharers"], ' adasda d ad da no fafasdfsd nowqfw students no studen tnostudnt'))
assert(prefixPostfixSearch(['no ', 'geen '], ['students', 'home sharers', "sharers"], ' adasda d ad da no fafasdfsd nowqfw students no studen tnostudnt no students'))
assert(prefixPostfixSearch(['no ', 'geen '], ['students', 'home sharers', "sharers"], ' adasda d ad da no fafasdfsd nowqfw students no studen tnostudnt no student geen sharers'))
assert(prefixPostfixSearch(config.BLACKLIST_PREFIXES, config.BLACKLIST_POSTFIXES, ' adasda d ad da no fafasdfsd nowqfw students no studen tnostudnt niet geschikt voor studenten'))
assert(prefixPostfixSearch(config.BLACKLIST_PREFIXES, config.BLACKLIST_POSTFIXES, 'niet geschikt voor studenten'))
assert(prefixPostfixSearch(config.BLACKLIST_PREFIXES, config.BLACKLIST_POSTFIXES, ' adasda d ad da no fafasdfsd nowqfw students no studen tnostudnt niet voor studenten'))
assert(!prefixPostfixSearch(config.BLACKLIST_PREFIXES, config.BLACKLIST_POSTFIXES, ' adasda d ad da no fafasdfsd nowqfw students no studen tnostudnt niet voor wonigdelers ddfds'))
assert(prefixPostfixSearch(config.BLACKLIST_PREFIXES, config.BLACKLIST_POSTFIXES, ' adasda d ad da no fafasdfsd nowqfw students no studen tnostudnt niet voor woningdelers'))

function prefixPostfixSearch(prefixes: string[], postfixes: string[], text: string) {
    for (let prefix of prefixes) {
        let start = 0;
        while (start < text.length) {
            let startIndex = text.indexOf(prefix, start);
            if (startIndex == -1) break;
            for (let postfix of postfixes) {
                if (startIndex + prefix.length + postfix.length <= text.length && text.startsWith(postfix, startIndex + prefix.length)) {
                    return true;
                }
            }
            start = startIndex + prefix.length;
        }
    }
    return false;
}

function urlify(s: string): string {
    return s.replace(/\s/g, '-').toLowerCase();
}

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}
