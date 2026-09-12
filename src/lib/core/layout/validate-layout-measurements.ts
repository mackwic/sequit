import type { GroupMeasurement, Size } from './layout-types';

function assertPositive(value: number, name: string): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a finite positive number`);
	}
}

function assertNonNegative(value: number, name: string): void {
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`${name} must be a finite non-negative number`);
	}
}

export function validateSize(size: Size, name: string): Size {
	assertPositive(size.width, `${name}.width`);
	assertPositive(size.height, `${name}.height`);
	return size;
}

export function validateGroupMeasurement(
	measurement: GroupMeasurement,
	groupId: string,
): GroupMeasurement {
	assertPositive(measurement.minimumWidth, `groups.${groupId}.minimumWidth`);
	assertPositive(measurement.minimumHeight, `groups.${groupId}.minimumHeight`);
	assertNonNegative(measurement.headerHeight, `groups.${groupId}.headerHeight`);
	assertNonNegative(measurement.padding, `groups.${groupId}.padding`);
	return {
		...measurement,
		minimumHeight: Math.max(
			measurement.minimumHeight,
			measurement.headerHeight + measurement.padding * 2,
		),
	};
}
