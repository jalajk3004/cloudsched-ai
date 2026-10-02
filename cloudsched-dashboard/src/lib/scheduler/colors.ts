import { SchedulerId } from "./types";

/** One consistent color per scheduler, used everywhere a scheduler is
 *  drawn (charts, legends, badges) - defined once here so every chart
 *  agrees on what color "qwen" is, without each component picking its
 *  own. Adding a 5th scheduler later means adding one line here. */
export const SCHEDULER_COLORS: Record<SchedulerId, string> = {
    baseline: "#a3a3a3", // neutral gray
    qwen: "#38bdf8", // sky blue
    gemini: "#c084fc", // violet (reserved, not connected yet)
    groq: "#fb923c", // orange (reserved, not connected yet)
};