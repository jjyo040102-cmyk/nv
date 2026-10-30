import {EventRepository} from "./repository";
import {WakeEngine} from "./wake-engine";

export class TriggerScheduler{
  constructor(private readonly events:EventRepository,private readonly wake:WakeEngine){}
  async tick(now=new Date()):Promise<number>{
    let count=0;
    for(const trigger of this.events.dueTimeTriggers(now)){
      if(!trigger.nextDueAt)continue;
      const due=trigger.nextDueAt;
      const key=`time:${due}`;
      try{
        const result=await this.wake.ingest({triggerId:trigger.id,ownerSessionId:trigger.ownerSessionId,eventKey:key,type:"TIME",payloadJson:{scheduledFor:due}});
        if(!result.woke&&result.event.status!=="PROCESSED")continue;
        const interval=typeof trigger.configJson.intervalMinutes==="number"?trigger.configJson.intervalMinutes:null;
        if(this.events.advanceTimeTrigger(trigger.id,due,now,interval))count++;
      }catch{
        // Leave next_due_at unchanged. The same idempotent event can be retried on a later tick.
      }
    }
    return count;
  }
}
