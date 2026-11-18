// 千根级结构冒烟测试:18 层 1027 根
import { computeStranding } from '../js/stranding.js';
const wireArea = Math.PI / 4 * 2.5 * 2.5;
const r = computeStranding({ area: Math.round(wireArea * 1000), wireDia: 2.5, layers: 18, material: 'copper' });
console.log(`总根数=${r.totalWires} 外径=${r.dOut.toFixed(1)}mm 填充系数=${(r.fillFactor * 100).toFixed(1)}% 平均绞入率=${((r.lambdaAvg - 1) * 100).toFixed(2)}%`);
console.log(`最外层: ${r.layers[17].n}根 节距=${r.layers[17].lay.toFixed(0)}mm 绞入率=${((r.layers[17].lambda - 1) * 100).toFixed(2)}%`);
console.log(`错误=${r.errors.length} 警告=${r.warnings.length}`);
