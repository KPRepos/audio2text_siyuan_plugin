import {
    Plugin,
    showMessage
} from "siyuan";
import "./index.scss";

import { SettingUtils } from "./libs/setting-utils";
import { transcribeAudio, getAudioPathFromElement } from "./libs/transcription";
import { getBlockKramdown, getBlockByID, insertBlock } from "./api";
const STORAGE_NAME = "menu-config";

export default class PluginSample extends Plugin {

    private blockIconEventBindThis = this.blockIconEvent.bind(this);
    private audioMenuEventBindThis = this.audioMenuEvent.bind(this);
    private settingUtils: SettingUtils;

    async onload() {
        this.data[STORAGE_NAME] = { openaiApiKey: "" };

        showMessage(`[${this.name}] Loaded`);
        
        // Register audio menu event listener
        this.eventBus.on("open-menu-av", this.audioMenuEventBindThis);
        // Match siyuan-plugin-tts behavior: add items to the block icon (left gutter) menu
        this.eventBus.on("click-blockicon", this.blockIconEventBindThis);

        this.addIcons(`<symbol id="iconFace" viewBox="0 0 32 32">
<path d="M13.667 17.333c0 0.92-0.747 1.667-1.667 1.667s-1.667-0.747-1.667-1.667 0.747-1.667 1.667-1.667 1.667 0.747 1.667 1.667zM20 15.667c-0.92 0-1.667 0.747-1.667 1.667s0.747 1.667 1.667 1.667 1.667-0.747 1.667-1.667-0.747-1.667-1.667-1.667zM29.333 16c0 7.36-5.973 13.333-13.333 13.333s-13.333-5.973-13.333-13.333 5.973-13.333 13.333-13.333 13.333 5.973 13.333 13.333zM14.213 5.493c1.867 3.093 5.253 5.173 9.12 5.173 0.613 0 1.213-0.067 1.787-0.16-1.867-3.093-5.253-5.173-9.12-5.173-0.613 0-1.213 0.067-1.787 0.16zM5.893 12.627c2.28-1.293 4.040-3.4 4.88-5.92-2.28 1.293-4.040 3.4-4.88 5.92zM26.667 16c0-1.040-0.16-2.040-0.44-2.987-0.933 0.2-1.893 0.32-2.893 0.32-4.173 0-7.893-1.92-10.347-4.92-1.4 3.413-4.187 6.093-7.653 7.4 0.013 0.053 0 0.12 0 0.187 0 5.88 4.787 10.667 10.667 10.667s10.667-4.787 10.667-10.667z"></path>
</symbol>`);

        this.settingUtils = new SettingUtils({
            plugin: this, name: STORAGE_NAME
        });
        this.settingUtils.addItem({
            key: "OpenAIAPIKey",
            value: "",
            type: "textinput",
            title: this.i18n.openaiApiKey,
            description: this.i18n.openaiApiKeyDesc,
            action: {
                callback: () => {
                    let value = this.settingUtils.takeAndSave("OpenAIAPIKey");
                    this.data[STORAGE_NAME].openaiApiKey = value;
                }
            }
        });
        this.settingUtils.addItem({
            key: "Hint",
            value: "",
            type: "hint",
            title: this.i18n.hintTitle,
            description: this.i18n.hintDesc,
        });

        this.addTopBar({
            icon: "iconFace",
            title: this.i18n.addTopBarIcon,
            position: "right",
            callback: () => {
                // Keep top-bar behavior minimal: open plugin settings directly
                this.openSetting();
            }
        });

        // Load OpenAI API key from settings if available
        try {
            await this.settingUtils.load();
            if (!this.data[STORAGE_NAME].openaiApiKey) {
                const savedKey = this.settingUtils.get("OpenAIAPIKey");
                if (savedKey) {
                    this.data[STORAGE_NAME].openaiApiKey = savedKey;
                }
            }
        } catch (error) {
            // Settings storage may be empty on first load
        }
    }

    async onunload() {
        // Unregister audio menu event listener
        this.eventBus.off("open-menu-av", this.audioMenuEventBindThis);
        this.eventBus.off("click-blockicon", this.blockIconEventBindThis);
    }

    uninstall() {
        // 卸载插件时删除插件数据
        // Delete plugin data when uninstalling the plugin
        this.removeData(STORAGE_NAME).catch(e => {
            showMessage(`uninstall [${this.name}] remove data [${STORAGE_NAME}] fail: ${e.msg}`);
        });
    }

    private blockIconEvent({ detail }: any) {
        // Transcribe menu entry: only actionable when an audio block is selected.
        detail.menu.addItem({
            id: "pluginSample_transcribe_test_blockicon",
            icon: "iconRecord",
            label: this.i18n.transcribeAudio,
            click: async () => {
                const hasAudio = Array.isArray(detail.blockElements) && detail.blockElements.some((el: HTMLElement) => el?.querySelector?.("audio"));
                if (!hasAudio) {
                    showMessage(`[${this.name}] Select an audio block to transcribe.`, "info");
                    return;
                }
                await this.handleTranscribeAudio(detail);
            }
        });
    }

    private audioMenuEvent({ detail }: any) {
        const hasMedia = Array.isArray(detail.blockElements) && detail.blockElements.some((element: HTMLElement) => {
            const hasAudio = element.querySelector("audio") !== null;
            const hasVideo = element.querySelector("video") !== null;
            const blockType = element.getAttribute("data-type") || element.dataset?.type;
            const isAVBlock = blockType === "av" || blockType === "audio" || blockType === "video";
            return hasAudio || hasVideo || isAVBlock;
        });

        // Only add the menu item when an audio/video block is actually present.
        if (hasMedia) {
            detail.menu.addItem({
                id: "pluginSample_transcribeAudio",
                icon: "iconRecord",
                label: this.i18n.transcribeAudio,
                click: async () => {
                    await this.handleTranscribeAudio(detail);
                }
            });
        }
    }

    private async handleTranscribeAudio(detail: any) {
        const apiKey = this.data[STORAGE_NAME]?.openaiApiKey || this.settingUtils.get("OpenAIAPIKey");
        
        if (!apiKey) {
            showMessage(this.i18n.apiKeyRequired, "error");
            this.openSetting();
            return;
        }

        // Get the first audio block element
        const audioElement = detail.blockElements.find((element: HTMLElement) => {
            return element.querySelector("audio") !== null;
        });

        if (!audioElement) {
            showMessage(this.i18n.audioFileNotFound, "error");
            return;
        }

        // Get audio file path
        let audioPath = getAudioPathFromElement(audioElement);
        
        // If we couldn't get the path from the element, try to get it from the block
        if (!audioPath) {
            const blockId = audioElement.dataset.nodeId;
            if (blockId) {
                try {
                    const blockKramdown = await getBlockKramdown(blockId);
                    // Extract path from markdown: ![name](path)
                    const markdownMatch = blockKramdown.kramdown.match(/!\[.*?\]\((.*?)\)/);
                    if (markdownMatch && markdownMatch[1]) {
                        audioPath = markdownMatch[1];
                    }
                } catch (error) {
                    // Failed to get block kramdown
                }
            }
        }

        if (!audioPath) {
            showMessage(this.i18n.audioFileNotFound, "error");
            return;
        }

        // Show transcribing message
        showMessage(this.i18n.transcribing);

        try {
            // Transcribe the audio
            const transcription = await transcribeAudio(audioPath, {
                apiKey: apiKey
            });

            // Insert the transcription after the audio block
            const blockId = audioElement.dataset.nodeId;
            if (blockId) {
                try {
                    // Get the block to find its parent
                    const block = await getBlockByID(blockId);
                    const parentID = block.parent_id || block.root_id;
                    
                    // Insert the transcription as a new block after the audio block
                    await insertBlock("markdown", transcription, undefined, blockId, parentID);
                    showMessage(this.i18n.transcriptionSuccess);
                } catch (error: any) {
                    // Fallback: show the transcription in a message
                    showMessage(transcription);
                }
            } else {
                // Fallback: just show the transcription
                showMessage(transcription);
            }
        } catch (error: any) {
            showMessage(`${this.i18n.transcriptionError}: ${error.message}`, "error");
        }
    }
}
