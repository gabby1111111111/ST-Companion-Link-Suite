
// Mock Context (Late Night + Binge + Cross Platform)
const mockCtx = {
    action: 'coin',
    timestamp: '2026-02-19T02:30:00.000Z', 
    note: {
        platform: 'bilibili',
        title: 'Wuthering Waves Guide',
        tags: ['Game', 'Wuthering Waves', 'Strategy'],
        play_progress: '00:10 / 10:00'
    },
    buffer_entries: [
        { title: 'Wuthering Waves Fan Art', tags: ['Wuthering Waves', 'Art'], url: 'https://www.xiaohongshu.com/explore/123' },
        { title: 'Genshin Impact', tags: ['Game'], url: 'https://www.bilibili.com/video/456' },
        { title: 'Honkai Star Rail', tags: ['Game'], url: 'https://www.bilibili.com/video/789' },
        { title: 'Another Game', tags: ['Game'], url: 'https://www.bilibili.com/video/012' }
    ],
    formatted_text: "> 📱 **Bilibili**\n> title"
};

function buildInjectionText(ctx) {
    const formattedText = ctx.formatted_text || '';
    const note = ctx.note || {};
    const platform = note.platform || 'xiaohongshu'; 
    const bufferEntries = ctx.buffer_entries || [];

    // 1. Vibe Check (Narrative Intro)
    let vibeIntro = "";
    const hour = new Date(ctx.timestamp).getHours(); // Mock time
    const isLateNight = hour >= 1 && hour <= 5;
    const isBingeWatching = bufferEntries.length >= 4;

    if (isLateNight) {
        vibeIntro = `（此时夜色已深，屋里只有屏幕的微光照在 {{user}} 脸上... 他似乎并无睡意，正在 B 站上刷着视频...）`;
    } else if (isBingeWatching) {
        vibeIntro = `（{{user}} 看起来非常投入，已经在屏幕前连续看了好一会儿 B 站了，似乎完全沉浸在了内容里...）`;
    }

    // 2. Intuition (Internal Monologue)
    let internalMonologue = "";
    // Cross Platform
    const currentTags = new Set(note.tags || []);
    const hits = bufferEntries.filter(e => e.url.includes('xiaohongshu') && e.tags.some(t => currentTags.has(t)));
    
    if (hits.length > 0) {
        const commonTopic = hits[0].tags[0];
        internalMonologue += `（{{char}} 隐约觉得，他最近好像对“${commonTopic}”格外上心，这种似曾相识的感觉...）`;
    }

    // 3. Motivation (Observation)
    let detailObservation = "";
    if (ctx.action === 'coin') {
         if (isBingeWatching) {
            detailObservation = `（他连续划走了那么多，唯独在这个视频前停下并投了币... {{char}} 注意到了这个细节。）`;
         } else {
            detailObservation = `（{{char}} 看到他毫不犹豫地投了币，眼神里带着认可。）`;
         }
    }
    
    // Progress Observation
    if (note.play_progress) {
         try {
             const pct = 1.6; // Mock result
             if (pct < 5) detailObservation += `\n（但进度条才刚开始走... 这就投币了？{{char}} 挑了挑眉。）`;
         } catch(e) {}
    }

    // 4. 构建最终叙事 (Prompt 3.0: Pure Narrative + Draft Instruction)
    // ============================================================
    
    // 如果存在跨平台共性，引导 AI 拟定评论
    let draftInstruction = "";
    if (hits.length > 0) {
        draftInstruction = `\n[系统提示：检测到跨平台关联。若想帮助用户互动，请在回复末尾以此格式拟定评论草稿：(拟稿: 你的评论内容)]`;
    }

    const narrativeBody = `
${vibeIntro}
${internalMonologue}
${detailObservation}
（空气里有一瞬间的安静。）${draftInstruction}`.trim();

    return `${formattedText}\n\n${narrativeBody}`;
}

const result = buildInjectionText(mockCtx);
console.log(result);
// Simulate AI Response with Draft
console.log("\n--- AI Response Simulation ---");
console.log("AI: 哎呀，看来你真的很喜欢这个话题呢。（笑）\n(拟稿: 看了小红书的攻略再看这个实战，感觉思路清晰多了！UP主操作太强了！)");
