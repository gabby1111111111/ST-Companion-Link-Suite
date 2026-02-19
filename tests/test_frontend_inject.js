// Mock Environment
const titleKeywords = ["鸣潮", "攻略"];
const currentTags = new Set(["游戏", "开放世界", "鸣潮"]);
const platform = "bilibili";

// Mock Telemetry Data
const latestTelemetry = {
    last_session: {
        type: "gaming",
        name: "鸣潮",
        duration_minutes: 60,
        minutes_ago: 5
    },
    resources: {
        memory_pressure: true,
        cpu_load: 85
    }
};

// Extracted Logic from index.js (Simplified for Test)
function buildInjectionText() {
    let sensoryObservation = "";
    let draftInstruction = "";

    // 1. Gaming -> Content Linkage (Phase 20 Logic)
    if (latestTelemetry && latestTelemetry.last_session) {
        const ls = latestTelemetry.last_session;
        if (ls.type === 'gaming' && ls.minutes_ago < 60) {
            const gameName = ls.name || "";
            const isRelated = titleKeywords.some(k => gameName.includes(k)) || 
                              [...currentTags].some(t => gameName.includes(t) || t.includes(gameName));
                              
            if (isRelated) {
                draftInstruction = `\n[系统提示：检测到用户刚结束《${gameName}》并正在观看相关内容。请结合他的游戏体验（刚玩了 ${ls.duration_minutes} 分钟），拟定一条“玩家视角的”评论草稿。格式：(拟稿: ...)]`;
            }
        }
    }

    // 2. Stage Setting (Phase 19 Logic)
    if (latestTelemetry) {
        // History
        const lastSession = latestTelemetry.last_session;
        if (lastSession && lastSession.type === 'gaming' && lastSession.minutes_ago < 30) {
             sensoryObservation += `（此时，{{char}} 注意到他终于关掉了运行了 ${lastSession.duration_minutes} 分钟的《${lastSession.name}》，正靠在椅子上休息... 电脑的热气还没散去...）\n`;
        }
        
        // Heat
        const resources = latestTelemetry.resources || {};
        if (resources.memory_pressure || (resources.cpu_load && resources.cpu_load > 80)) {
            sensoryObservation += `（主机箱的风扇声似乎比平时喧嚣了一些，空气里隐约透着一丝电子元件全速运转的热度...）\n`;
        }
    }
    
    return { sensoryObservation, draftInstruction };
}

// Run Test
console.log("🧪 Testing Frontend Logic...");
const result = buildInjectionText();

console.log("\n--- Sensory Observation ---");
console.log(result.sensoryObservation);

console.log("\n--- Draft Instruction ---");
console.log(result.draftInstruction);

// Assertions
if (!result.draftInstruction.includes("(拟稿:")) {
    console.error("❌ FAILED: Draft Instruction missing '拟稿'");
    process.exit(1);
}
if (!result.sensoryObservation.includes("电脑的热气")) {
    console.error("❌ FAILED: Sensory Observation missing 'Heat'");
    process.exit(1);
}
if (!result.sensoryObservation.includes("鸣潮")) {
    console.error("❌ FAILED: Sensory Observation missing Game Name");
    process.exit(1);
}

console.log("\n✅ Frontend Logic Tests Passed!");
