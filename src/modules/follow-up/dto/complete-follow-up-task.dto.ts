import { FollowUpAnswer, RepeatBusinessAnswer } from '../follow-up.constants';

export class CompleteFollowUpTaskDto {
  callRecordId!: string;
  /** A repeat-business task takes one of REPEAT_BUSINESS_ANSWERS; every other task one of FOLLOW_UP_ANSWERS. */
  answer!: FollowUpAnswer | RepeatBusinessAnswer;
  answerBusinessId?: string;
  notes?: string;
  /**
   * With answer 'working_elsewhere' on a job seeker's task: true records that he found a
   * job on his own (profile closed, no ₹499 refund).
   */
  foundOwnJob?: boolean;
}
