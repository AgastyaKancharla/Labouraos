import { FollowUpAnswer } from '../follow-up.constants';

export class CompleteFollowUpTaskDto {
  callRecordId!: string;
  answer!: FollowUpAnswer;
  answerBusinessId?: string;
  notes?: string;
  /**
   * With answer 'working_elsewhere' on a job seeker's task: true records that he found a
   * job on his own (profile closed, no ₹499 refund).
   */
  foundOwnJob?: boolean;
}
