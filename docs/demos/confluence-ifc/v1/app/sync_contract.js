/* Frame order belongs to the protocol, not to animation callbacks. */
(function(root){
 class SyncError extends Error{}
 function next(current,event){
  if(event.type==='snapshot'){if(!Number.isInteger(event.revision)||event.revision<0)throw new SyncError('BAD_REVISION');if(event.revision<current)throw new SyncError('SNAPSHOT_ROLLBACK');return 'snapshot'}
  if(event.type!=='commit')throw new SyncError('BAD_EVENT');
  if(!Number.isInteger(event.revision)||!Number.isInteger(event.base_revision))throw new SyncError('BAD_REVISION');
  if(event.revision<=current)return 'duplicate';
  if(event.base_revision!==current||event.revision!==current+1)throw new SyncError('REVISION_GAP');
  return 'apply';
 }
 const api={next,SyncError};if(typeof module!=='undefined')module.exports=api;else root.BridgeSync=api;
})(globalThis);
