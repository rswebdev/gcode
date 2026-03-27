import { writable } from 'svelte/store';
export const activeTab = writable('wave'); // 'wave' | 'gcode' | 'serial'
