import {Flexbox, Text, TextArea} from '@lobehub/ui'
import {useComponentData} from '../lib/componentData'
import {registerComponent, type ComponentProps} from '../lib/registry'

type NoteConfig = {
  heading: string
  rows: number
}

function Note({instance, config}: ComponentProps<NoteConfig>) {
  // 便签正文属于这个实例，按实例 id 隔离；同一页放两张便签互不影响
  const [text, setText] = useComponentData<string>(instance.id, '')
  return (
    <Flexbox className="page-pane" direction="vertical" gap={8}>
      {config.heading && <Text as="h2">{config.heading}</Text>}
      <TextArea
        className="note-area"
        aria-label={config.heading || '便签'}
        value={text}
        placeholder="随手记下什么，AI 也可以往这里写。"
        autoSize={{minRows: config.rows, maxRows: config.rows + 10}}
        onChange={(event) => setText(event.target.value)}
      />
    </Flexbox>
  )
}

registerComponent<NoteConfig>({
  type: 'note',
  name: '便签',
  description: '一块可随手书写的文本区。内容保存在本地，AI 也能读写。可以放多张，各自独立。',
  category: 'tool',
  defaultConfig: {heading: '便签', rows: 8},
  configSchema: {
    heading: {kind: 'string', label: '标题', placeholder: '留空则不显示'},
    rows: {kind: 'number', label: '最少行数', min: 3, max: 30},
  },
  defaultSpan: 'half',
  component: Note,
  multiple: true,
})
