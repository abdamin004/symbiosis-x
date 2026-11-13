import metrics from "../../../catalogs/crew/health-metrics.json";
import guides from "../../../catalogs/crew/health-guides.json";

export const HEALTH_METRICS = metrics.metrics;
export const HEALTH_GUIDES = new Map(guides.guides.map((guide) => [guide.metric_id, guide]));
export const HEALTH_GUIDE_DISCLAIMER = guides.disclaimer;
