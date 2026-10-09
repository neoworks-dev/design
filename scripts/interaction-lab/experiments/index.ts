import type { Experiment } from '../lab';
import { altDuplicate } from './altDuplicate';
import { autoLayoutReorder } from './autoLayoutReorder';
import { doubleClick } from './doubleClick';
import { dragThreshold } from './dragThreshold';
import { escapeAndUndo } from './escapeAndUndo';
import { modifierDuringDrag } from './modifierDuringDrag';
import { marqueeThenDrag } from './marqueeThenDrag';
import { multiSelectionClick } from './multiSelectionClick';
import { nestedMultiDrag } from './nestedMultiDrag';
import { nudge } from './nudge';
import { pasteDestination } from './pasteDestination';
import { duplicate } from './duplicate';
import { pasteHere } from './pasteHere';
import { pasteView } from './pasteView';
import { pasteOtherPage } from './pasteOtherPage';
import { pasteNextTo } from './pasteNextTo';
import { pasteNodeTypes } from './pasteNodeTypes';
import { pasteOffscreen } from './pasteOffscreen';
import { performanceGrid } from './performanceGrid';
import { reparent } from './reparent';
import { selectionOutlineSync } from './selectionOutlineSync';
import { shiftAxisLock } from './shiftAxisLock';
import { snapDistance } from './snapDistance';

export const experiments: Experiment[] = [
	dragThreshold,
	doubleClick,
	shiftAxisLock,
	altDuplicate,
	escapeAndUndo,
	nudge,
	snapDistance,
	modifierDuringDrag,
	reparent,
	autoLayoutReorder,
	multiSelectionClick,
	nestedMultiDrag,
	selectionOutlineSync,
	marqueeThenDrag,
	pasteNextTo,
	pasteOtherPage,
	pasteHere,
	pasteView,
	duplicate,
	pasteDestination,
	pasteNodeTypes,
	pasteOffscreen,
	performanceGrid
];
