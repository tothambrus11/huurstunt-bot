import fs from "fs/promises";

export interface LinkInfo {
    title?: string;
    email?: string;
    concerningTexts?: ConcerningMatch[];
    price?: number,
    peopleCount?: number,
    roomPrice?: number,
    bedroomCount?: number,
    suitable?: boolean,
    responded?: boolean,
    distance: number,
    hasDetails: boolean,
}

export interface ConcerningMatch {
    index: number,
    concerningText: string,
    concerningSentence?: string
}

export type LinkInfos = { [name: string]: LinkInfo };

export async function loadLinkInfos(): Promise<LinkInfos> {
    try {
        await fs.access("data.json");
        let result = await fs.readFile("data.json", {encoding: "utf8"});
        return JSON.parse(result) as LinkInfos;
    } catch (e) {
        console.log("[INFO]: data cache not found", e)
        return {}
    }
}
