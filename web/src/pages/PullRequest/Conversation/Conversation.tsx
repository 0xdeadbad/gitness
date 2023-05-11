import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Color,
  Container,
  FlexExpander,
  FontVariation,
  Icon,
  IconName,
  Layout,
  Select,
  SelectOption,
  StringSubstitute,
  Text,
  useToaster
} from '@harness/uicore'
import cx from 'classnames'
import { useGet, useMutate } from 'restful-react'
import { Diff2HtmlUI } from 'diff2html/lib-esm/ui/js/diff2html-ui'
import ReactTimeago from 'react-timeago'
import * as Diff2Html from 'diff2html'
import { get, orderBy } from 'lodash-es'
import { Render } from 'react-jsx-match'
import { CodeIcon, GitInfoProps } from 'utils/GitUtils'
import { MarkdownViewer } from 'components/MarkdownViewer/MarkdownViewer'
import { useStrings } from 'framework/strings'
import { useAppContext } from 'AppContext'
import type { TypesPullReqActivity } from 'services/code'
import { CommentAction, CommentBox, CommentBoxOutletPosition, CommentItem } from 'components/CommentBox/CommentBox'
import { useConfirmAct } from 'hooks/useConfirmAction'
import { CodeCommentState, formatDate, formatTime, getErrorMessage, orderSortDate, dayAgoInMS } from 'utils/Utils'
import { activityToCommentItem, CommentType, DIFF2HTML_CONFIG, ViewStyle } from 'components/DiffViewer/DiffViewerUtils'
import { NavigationCheck } from 'components/NavigationCheck/NavigationCheck'
import { ThreadSection } from 'components/ThreadSection/ThreadSection'
import { PullRequestTabContentWrapper } from '../PullRequestTabContentWrapper'
import { DescriptionBox } from './DescriptionBox'
import { PullRequestActionsBox } from './PullRequestActionsBox/PullRequestActionsBox'
import PullRequestSideBar from './PullRequestSideBar/PullRequestSideBar'
import css from './Conversation.module.scss'

export interface ConversationProps extends Pick<GitInfoProps, 'repoMetadata' | 'pullRequestMetadata'> {
  onCommentUpdate: () => void
  prHasChanged?: boolean
}

export enum prSortState {
  SHOW_EVERYTHING = 'showEverything',
  ALL_COMMENTS = 'allComments',
  WHATS_NEW = 'whatsNew',
  MY_COMMENTS = 'myComments'
}

export const Conversation: React.FC<ConversationProps> = ({
  repoMetadata,
  pullRequestMetadata,
  onCommentUpdate,
  prHasChanged
}) => {
  const { getString } = useStrings()
  const { currentUser } = useAppContext()
  const {
    data: activities,
    loading,
    error,
    refetch: refetchActivities
  } = useGet<TypesPullReqActivity[]>({
    path: `/api/v1/repos/${repoMetadata.path}/+/pullreq/${pullRequestMetadata.number}/activities`
  })
  const showSpinner = useMemo(() => loading && !activities, [loading, activities])
  const { data: reviewers } = useGet<Unknown[]>({
    path: `/api/v1/repos/${repoMetadata.path}/+/pullreq/${pullRequestMetadata.number}/reviewers`
  })
  const { showError } = useToaster()
  const [newComments, setNewComments] = useState<TypesPullReqActivity[]>([])
  const [dateOrderSort, setDateOrderSort] = useState<boolean | 'desc' | 'asc'>(orderSortDate.ASC)
  const [prShowState, setPrShowState] = useState<SelectOption>({
    label: `Show Everything `,
    value: 'showEverything'
  })
  const activityBlocks = useMemo(() => {
    // Each block may have one or more activities which are grouped into it. For example, one comment block
    // contains a parent comment and multiple replied comments
    const blocks: CommentItem<TypesPullReqActivity>[][] = []

    // Determine all parent activities
    const parentActivities = orderBy(
      activities?.filter(activity => !activity.parent_id) || [],
      'edited',
      dateOrderSort
    ).map(_comment => [_comment])

    // Then add their children as follow-up elements (same array)
    parentActivities?.forEach(parentActivity => {
      const childActivities = activities?.filter(activity => activity.parent_id === parentActivity[0].id)

      childActivities?.forEach(childComment => {
        parentActivity.push(childComment)
      })
    })

    parentActivities?.forEach(parentActivity => {
      blocks.push(parentActivity.map(activityToCommentItem))
    })

    if (newComments.length) {
      blocks.push(orderBy(newComments, 'edited', orderSortDate.ASC).map(activityToCommentItem))
    }

    // Group title-change events into one single block
    // Disabled for now, @see https://harness.atlassian.net/browse/SCM-79
    // const titleChangeItems =
    //   blocks.filter(
    //     _activities => isSystemComment(_activities) && _activities[0].payload?.type === CommentType.TITLE_CHANGE
    //   ) || []

    // titleChangeItems.forEach((value, index) => {
    //   if (index > 0) {
    //     titleChangeItems[0].push(...value)
    //   }
    // })
    // titleChangeItems.shift()
    // return blocks.filter(_activities => !titleChangeItems.includes (_activities))

    if (prShowState.value === prSortState.ALL_COMMENTS) {
      const allCommentBlock = blocks.filter(_activities => !isSystemComment(_activities))
      return allCommentBlock
    }

    if (prShowState.value === prSortState.WHATS_NEW) {
      // get current time in seconds and subtract it by a day and see if comments are newer than a day
      const lastComment = blocks[blocks.length - 1]
      const lastCommentTime = lastComment[lastComment.length - 1].payload?.edited
      if (lastCommentTime !== undefined) {
        const currentTime = lastCommentTime - dayAgoInMS

        const newestBlock = blocks.filter(_activities => {
          const mostRecentComment = _activities[_activities.length - 1]
          if (mostRecentComment?.payload?.edited !== undefined) {
            return mostRecentComment?.payload?.edited > currentTime
          }
        })
        return newestBlock
      }
    }

    // show only comments made by user or replies in threads by user
    if (prShowState.value === prSortState.MY_COMMENTS) {
      const allCommentBlock = blocks.filter(_activities => !isSystemComment(_activities))
      const userCommentsOnly = allCommentBlock.filter(_activities => {
        const userCommentReply = _activities.filter(
          authorIsUser => authorIsUser.payload?.author?.uid === currentUser.uid
        )
        if (userCommentReply.length !== 0) {
          return true
        } else {
          return false
        }
      })
      return userCommentsOnly
    }

    return blocks
  }, [activities, newComments, dateOrderSort, prShowState, currentUser.uid])
  const path = useMemo(
    () => `/api/v1/repos/${repoMetadata.path}/+/pullreq/${pullRequestMetadata.number}/comments`,
    [repoMetadata.path, pullRequestMetadata.number]
  )
  const { mutate: saveComment } = useMutate({ verb: 'POST', path })
  const { mutate: updateComment } = useMutate({ verb: 'PATCH', path: ({ id }) => `${path}/${id}` })
  const { mutate: updateCodeCommentStatus } = useMutate({ verb: 'PUT', path: ({ id }) => `${path}/${id}/status` })
  const { mutate: deleteComment } = useMutate({ verb: 'DELETE', path: ({ id }) => `${path}/${id}` })
  const confirmAct = useConfirmAct()
  const [commentCreated, setCommentCreated] = useState(false)
  const [dirtyNewComment, setDirtyNewComment] = useState(false)
  const [dirtyCurrentComments, setDirtyCurrentComments] = useState(false)
  const codeCommentStatusItems = useMemo(
    () => [
      {
        label: getString('active'),
        value: CodeCommentState.ACTIVE
      },
      {
        label: getString('resolved'),
        value: CodeCommentState.RESOLVED
      }
    ],
    [getString]
  )
  const onPRStateChanged = useCallback(() => {
    onCommentUpdate()
    refetchActivities()
  }, [onCommentUpdate, refetchActivities])

  useEffect(() => {
    if (prHasChanged) {
      refetchActivities()
    }
  }, [prHasChanged, refetchActivities])

  useAnimateNewCommentBox(commentCreated, setCommentCreated)

  return (
    <PullRequestTabContentWrapper loading={showSpinner} error={error} onRetry={refetchActivities}>
      <Container>
        <Layout.Vertical spacing="xlarge">
          <PullRequestActionsBox
            repoMetadata={repoMetadata}
            pullRequestMetadata={pullRequestMetadata}
            onPRStateChanged={onPRStateChanged}
          />
          <Container>
            <Layout.Horizontal>
              <Container width={`70%`}>
                <Layout.Vertical spacing="xlarge">
                  <DescriptionBox
                    repoMetadata={repoMetadata}
                    pullRequestMetadata={pullRequestMetadata}
                    onCommentUpdate={onCommentUpdate}
                  />
                  <Layout.Horizontal className={css.sortContainer} padding={{ top: 'xxlarge', bottom: 'medium' }}>
                    <Container width={200}>
                      <Select
                        items={[
                          {
                            label: getString('showEverything'),
                            value: prSortState.SHOW_EVERYTHING
                          },
                          {
                            label: getString('allComments'),
                            value: prSortState.ALL_COMMENTS
                          },
                          {
                            label: getString('whatsNew'),
                            value: prSortState.WHATS_NEW
                          },
                          {
                            label: getString('myComments'),
                            value: prSortState.MY_COMMENTS
                          }
                          // {
                          //   label: 'Active comments',
                          //   value: 'activeComments'
                          // },
                          // {
                          //   label: 'Resolved comments',
                          //   value: 'resolvedComments'
                          // }
                        ]}
                        value={prShowState}
                        className={css.selectButton}
                        onChange={newState => {
                          setPrShowState(newState)
                          refetchActivities()
                        }}
                      />
                    </Container>
                    <FlexExpander />

                    <Text
                      className={css.timeButton}
                      rightIconProps={{ size: 24 }}
                      rightIcon={dateOrderSort === orderSortDate.ASC ? 'code-ascending' : 'code-descending'}
                      onClick={() => {
                        if (dateOrderSort === orderSortDate.ASC) {
                          setDateOrderSort(orderSortDate.DESC)
                        } else {
                          setDateOrderSort(orderSortDate.ASC)
                        }
                      }}>
                      {dateOrderSort === orderSortDate.ASC ? getString('ascending') : getString('descending')}
                    </Text>
                  </Layout.Horizontal>

                  {activityBlocks?.map((blocks, index) => {
                    const threadId = blocks[0].payload?.id
                    const commentItems = blocks
                    const codeCommentStatus = blocks[0].payload?.resolved
                      ? codeCommentStatusItems[1]
                      : codeCommentStatusItems[0]

                    if (isSystemComment(commentItems)) {
                      return (
                        <ThreadSection
                          key={`thread-${threadId}`}
                          onlyTitle
                          lastItem={activityBlocks.length - 1 === index}
                          title={
                            <SystemBox
                              key={`system-${threadId}`}
                              pullRequestMetadata={pullRequestMetadata}
                              commentItems={commentItems}
                            />
                          }></ThreadSection>
                      )
                    }
                    return (
                      <ThreadSection
                        key={`comment-${threadId}`}
                        onlyTitle={
                          activityBlocks[index + 1] !== undefined && isSystemComment(activityBlocks[index + 1])
                            ? true
                            : false
                        }
                        inCommentBox={
                          activityBlocks[index + 1] !== undefined && isSystemComment(activityBlocks[index + 1])
                            ? true
                            : false
                        }
                        title={
                          <CommentBox
                            key={threadId}
                            fluid
                            className={cx({
                              [css.hideDottedLine]: true,
                              [css.newCommentCreated]: commentCreated && index === activityBlocks.length - 1
                            })}
                            commentItems={commentItems}
                            currentUserName={currentUser.display_name}
                            setDirty={setDirtyCurrentComments}
                            handleAction={async (action, value, commentItem) => {
                              let result = true
                              let updatedItem: CommentItem<TypesPullReqActivity> | undefined = undefined
                              const id = (commentItem as CommentItem<TypesPullReqActivity>)?.payload?.id

                              switch (action) {
                                case CommentAction.DELETE:
                                  result = false
                                  await confirmAct({
                                    message: getString('deleteCommentConfirm'),
                                    action: async () => {
                                      await deleteComment({}, { pathParams: { id } })
                                        .then(() => {
                                          result = true
                                        })
                                        .catch(exception => {
                                          result = false
                                          showError(
                                            getErrorMessage(exception),
                                            0,
                                            getString('pr.failedToDeleteComment')
                                          )
                                        })
                                    }
                                  })
                                  break

                                case CommentAction.REPLY:
                                  await saveComment({ text: value, parent_id: Number(threadId) })
                                    .then(newComment => {
                                      updatedItem = activityToCommentItem(newComment)
                                    })
                                    .catch(exception => {
                                      result = false
                                      showError(getErrorMessage(exception), 0, getString('pr.failedToSaveComment'))
                                    })
                                  break

                                case CommentAction.UPDATE:
                                  await updateComment({ text: value }, { pathParams: { id } })
                                    .then(newComment => {
                                      updatedItem = activityToCommentItem(newComment)
                                    })
                                    .catch(exception => {
                                      result = false
                                      showError(getErrorMessage(exception), 0, getString('pr.failedToSaveComment'))
                                    })
                                  break
                              }

                              if (result) {
                                onCommentUpdate()
                              }

                              return [result, updatedItem]
                            }}
                            outlets={{
                              [CommentBoxOutletPosition.TOP_OF_FIRST_COMMENT]: isCodeComment(commentItems) && (
                                <CodeCommentHeader commentItems={commentItems} threadId={threadId} />
                              ),
                              [CommentBoxOutletPosition.LEFT_OF_OPTIONS_MENU]: (
                                <Select
                                  className={css.stateSelect}
                                  items={codeCommentStatusItems}
                                  value={codeCommentStatus}
                                  onChange={newState => {
                                    const payload = { status: newState.value }
                                    const id = commentItems[0]?.payload?.id

                                    updateCodeCommentStatus(payload, { pathParams: { id } })
                                      .then(() => {
                                        onCommentUpdate()
                                        refetchActivities()
                                      })
                                      .catch(exception => {
                                        showError(
                                          getErrorMessage(exception),
                                          0,
                                          getString('pr.failedToUpdateCommentStatus')
                                        )
                                      })
                                  }}
                                />
                              )
                            }}
                            autoFocusAndPositioning
                          />
                        }></ThreadSection>
                    )
                  })}

                  <CommentBox
                    fluid
                    commentItems={[]}
                    currentUserName={currentUser.display_name}
                    resetOnSave
                    hideCancel
                    setDirty={setDirtyNewComment}
                    handleAction={async (_action, value) => {
                      let result = true
                      let updatedItem: CommentItem<TypesPullReqActivity> | undefined = undefined

                      await saveComment({ text: value })
                        .then((newComment: TypesPullReqActivity) => {
                          updatedItem = activityToCommentItem(newComment)
                          setNewComments([...newComments, newComment])
                          setCommentCreated(true)
                        })
                        .catch(exception => {
                          result = false
                          showError(getErrorMessage(exception), 0)
                        })

                      if (result) {
                        onCommentUpdate()
                      }

                      return [result, updatedItem]
                    }}
                  />
                </Layout.Vertical>
              </Container>
              <PullRequestSideBar reviewers={reviewers} />
            </Layout.Horizontal>
          </Container>
        </Layout.Vertical>
      </Container>
      <NavigationCheck when={dirtyCurrentComments || dirtyNewComment} />
    </PullRequestTabContentWrapper>
  )
}

function isCodeComment(commentItems: CommentItem<TypesPullReqActivity>[]) {
  return commentItems[0]?.payload?.type === CommentType.CODE_COMMENT
}

interface CodeCommentHeaderProps {
  commentItems: CommentItem<TypesPullReqActivity>[]
  threadId: number | undefined
}

const CodeCommentHeader: React.FC<CodeCommentHeaderProps> = ({ commentItems, threadId }) => {
  const _isCodeComment = isCodeComment(commentItems)
  const id = `code-comment-snapshot-${threadId}`

  useEffect(() => {
    if (_isCodeComment) {
      // Note: Since payload does not have information about the file path, mode, and index, and we
      // don't render them anyway in the UI, we just use dummy info for them.
      const codeDiffSnapshot = [
        `diff --git a/src b/dest`,
        `new file mode 100644`,
        'index 0000000..0000000',
        '--- a/src',
        '+++ b/dest',
        get(commentItems[0], 'payload.payload.title', ''),
        ...get(commentItems[0], 'payload.payload.lines', [])
      ].join('\n')

      new Diff2HtmlUI(
        document.getElementById(id) as HTMLElement,
        Diff2Html.parse(codeDiffSnapshot, DIFF2HTML_CONFIG),
        Object.assign({}, DIFF2HTML_CONFIG, { outputFormat: ViewStyle.LINE_BY_LINE })
      ).draw()
    }
  }, [id, commentItems, _isCodeComment, threadId])

  return _isCodeComment ? (
    <Container className={css.snapshot}>
      <Layout.Vertical>
        <Container className={css.title}>
          <Text inline className={css.fname}>
            {commentItems[0].payload?.code_comment?.path}
          </Text>
        </Container>
        <Container className={css.snapshotContent} id={id} />
      </Layout.Vertical>
    </Container>
  ) : null
}

function isSystemComment(commentItems: CommentItem<TypesPullReqActivity>[]) {
  return commentItems[0].payload?.kind === 'system'
}

interface SystemBoxProps extends Pick<GitInfoProps, 'pullRequestMetadata'> {
  commentItems: CommentItem<TypesPullReqActivity>[]
}

const generateReviewDecisionIcon = (
  reviewDecision: string
): {
  name: IconName
  color: string | undefined
  size: number | undefined
  icon: IconName
  iconProps?: { color?: Color }
} => {
  let icon: IconName = 'dot'
  let color: Color | undefined = undefined
  let size: number | undefined = undefined

  switch (reviewDecision) {
    case 'changereq':
      icon = 'main-issue-filled'
      color = Color.ORANGE_700
      size = 18
      break
    case 'approved':
      icon = 'execution-success'
      size = 18
      color = Color.GREEN_700
      break
  }
  const name = icon
  return { name, color, size, icon, ...(color ? { iconProps: { color } } : undefined) }
}

const SystemBox: React.FC<SystemBoxProps> = ({ pullRequestMetadata, commentItems }) => {
  const { getString } = useStrings()
  const payload = commentItems[0].payload
  const type = payload?.type

  switch (type) {
    case CommentType.MERGE: {
      return (
        <Container>
          <Layout.Horizontal spacing="small" style={{ alignItems: 'center' }} className={css.mergedBox}>
            <Container margin={{ left: 'xsmall' }} width={24} height={24} className={css.mergeContainer}>
              <Icon name={CodeIcon.Merged} size={16} color={Color.PURPLE_700} />
            </Container>

            <Avatar name={pullRequestMetadata.merger?.display_name} size="small" hoverCard={false} />
            <Text>
              <StringSubstitute
                str={getString('pr.prMergedInfo')}
                vars={{
                  user: <strong>{pullRequestMetadata.merger?.display_name}</strong>,
                  source: <strong>{pullRequestMetadata.source_branch}</strong>,
                  target: <strong>{pullRequestMetadata.target_branch} </strong>,
                  time: <ReactTimeago date={pullRequestMetadata.merged as number} />
                }}
              />
            </Text>
          </Layout.Horizontal>
        </Container>
      )
    }

    case CommentType.REVIEW_SUBMIT: {
      return (
        <Container>
          <Layout.Horizontal spacing="small" style={{ alignItems: 'center' }} className={css.mergedBox}>
            <Icon
              margin={{ left: 'small' }}
              padding={{ right: 'small' }}
              {...generateReviewDecisionIcon((payload?.payload as Unknown)?.decision)}
            />

            <Avatar name={payload?.author?.display_name as string} size="small" hoverCard={false} />
            <Text color={Color.GREY_500}>
              <StringSubstitute
                str={getString('pr.prReviewSubmit')}
                vars={{
                  user: <strong>{payload?.author?.display_name}</strong>,
                  state: (payload?.payload as Unknown)?.decision,
                  time: <ReactTimeago className={css.timeText} date={payload?.created as number} />
                }}
              />
            </Text>
          </Layout.Horizontal>
        </Container>
      )
    }

    case CommentType.BRANCH_UPDATE: {
      return (
        <Container>
          <Layout.Horizontal spacing="small" style={{ alignItems: 'center' }} className={css.mergedBox}>
            <Avatar name={payload?.author?.display_name} size="small" hoverCard={false} />
            <Text>
              <StringSubstitute
                str={getString('pr.prBranchPushInfo')}
                vars={{
                  user: <strong>{payload?.author?.display_name}</strong>,
                  commit: <strong>{(payload?.payload as Unknown)?.new}</strong>
                }}
              />
            </Text>
            <Text
              inline
              font={{ variation: FontVariation.SMALL }}
              color={Color.GREY_400}
              width={100}
              style={{ textAlign: 'right' }}>
              <ReactTimeago date={payload?.created as number} />
            </Text>
          </Layout.Horizontal>
        </Container>
      )
    }

    case CommentType.STATE_CHANGE: {
      const openFromDraft =
        (payload?.payload as Unknown)?.old_draft === true && (payload?.payload as Unknown)?.new_draft === false

      return (
        <Container>
          <Layout.Horizontal spacing="small" style={{ alignItems: 'center' }} className={css.mergedBox}>
            <Avatar name={payload?.author?.display_name} size="small" hoverCard={false} />
            <Text>
              <StringSubstitute
                str={getString(openFromDraft ? 'pr.prStateChangedDraft' : 'pr.prStateChanged')}
                vars={{
                  user: <strong>{payload?.author?.display_name}</strong>,
                  old: <strong>{(payload?.payload as Unknown)?.old}</strong>,
                  new: <strong>{(payload?.payload as Unknown)?.new}</strong>
                }}
              />
            </Text>

            <Text
              inline
              font={{ variation: FontVariation.SMALL }}
              color={Color.GREY_400}
              width={100}
              style={{ textAlign: 'right' }}>
              <ReactTimeago date={payload?.created as number} />
            </Text>
          </Layout.Horizontal>
        </Container>
      )
    }

    case CommentType.TITLE_CHANGE: {
      return (
        <Container className={css.mergedBox}>
          <Layout.Horizontal spacing="small" style={{ alignItems: 'center' }}>
            <Avatar name={payload?.author?.display_name} size="small" hoverCard={false} />
            <Text tag="div">
              <StringSubstitute
                str={getString('pr.titleChanged')}
                vars={{
                  user: <strong>{payload?.author?.display_name}</strong>,
                  old: (
                    <strong>
                      <s>{(payload?.payload as Unknown)?.old}</s>
                    </strong>
                  ),
                  new: <strong>{(payload?.payload as Unknown)?.new}</strong>
                }}
              />
            </Text>

            <Text
              inline
              font={{ variation: FontVariation.SMALL }}
              color={Color.GREY_400}
              width={100}
              style={{ textAlign: 'right' }}>
              <ReactTimeago date={payload?.created as number} />
            </Text>
          </Layout.Horizontal>
          <Render when={commentItems.length > 1}>
            <Container
              margin={{ top: 'medium', left: 'xxxlarge' }}
              style={{ maxWidth: 'calc(100vw - 450px)', overflow: 'auto' }}>
              <MarkdownViewer
                source={[getString('pr.titleChangedTable').replace(/\n$/, '')]
                  .concat(
                    commentItems
                      .filter((_, index) => index > 0)
                      .map(
                        item =>
                          `|${item.author}|<s>${(item.payload?.payload as Unknown)?.old}</s>|${
                            (item.payload?.payload as Unknown)?.new
                          }|${formatDate(item.updated)} ${formatTime(item.updated)}|`
                      )
                  )
                  .join('\n')}
              />
            </Container>
          </Render>
        </Container>
      )
    }

    default: {
      // eslint-disable-next-line no-console
      console.warn('Unable to render system type activity', commentItems)
      return (
        <Text className={css.mergedBox}>
          <Icon name={CodeIcon.Commit} padding={{ right: 'small' }} />
          {type}
        </Text>
      )
    }
  }
}

function useAnimateNewCommentBox(
  commentCreated: boolean,
  setCommentCreated: React.Dispatch<React.SetStateAction<boolean>>
) {
  useEffect(() => {
    let timeoutId = 0

    if (commentCreated) {
      timeoutId = window.setTimeout(() => {
        const box = document.querySelector(`.${css.newCommentCreated}`)

        box?.scrollIntoView({ behavior: 'smooth', block: 'center' })

        timeoutId = window.setTimeout(() => {
          box?.classList.add(css.clear)
          timeoutId = window.setTimeout(() => setCommentCreated(false), 2000)
        }, 5000)
      }, 300)
    }

    return () => {
      clearTimeout(timeoutId)
    }
  }, [commentCreated, setCommentCreated])
}
