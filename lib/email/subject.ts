export const replySubjectBase = (value:string):string => value.replace(/^(?:\s*re\s*:\s*)+/i,'').trim();
export const replySubjectMatches = (reply:string,source:string):boolean => replySubjectBase(reply)===replySubjectBase(source);
