import {
  ActionButton,
  DangerButton,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuItemLabel,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  NavButton,
  PrimaryButton,
  ProjectTreeButton,
  SelectField,
  StatusPill,
  SurfaceCard,
  TextArea,
  TextInput,
  ThreadTreeButton
} from './ui';
import {
  AccountIcon,
  AutomationIcon,
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  NewThreadIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  SidebarIcon,
  SkillsIcon,
  ThreadDotIcon
} from './icons';

export function UiDevSurface() {
  return (
    <section className="catalog-view ui-dev-view">
      <header className="view-header">
        <div>
          <h2>UI Development Surface</h2>
          <p>Approved primitives only. Future UI work should match these controls before touching feature screens.</p>
        </div>
      </header>

      <div className="ui-dev-grid">
        <SurfaceCard>
          <h3>Navigation</h3>
          <div className="ui-dev-stack">
            <NavButton className="sidebar-action is-active" leadingIcon={<SidebarIcon><NewThreadIcon /></SidebarIcon>}>New thread</NavButton>
            <NavButton className="sidebar-action" leadingIcon={<SidebarIcon><AutomationIcon /></SidebarIcon>}>Automations</NavButton>
            <NavButton className="sidebar-action" leadingIcon={<SidebarIcon><SkillsIcon /></SidebarIcon>}>Skills</NavButton>
            <NavButton className="sidebar-action" leadingIcon={<SidebarIcon><SettingsIcon /></SidebarIcon>}>Settings</NavButton>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h3>Buttons</h3>
          <div className="ui-dev-stack">
            <PrimaryButton>Primary action</PrimaryButton>
            <ActionButton>Default action</ActionButton>
            <ActionButton tone="quiet">Quiet action</ActionButton>
            <DangerButton>Destructive action</DangerButton>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h3>Inputs</h3>
          <div className="ui-dev-stack">
            <TextInput placeholder="Text input" />
            <SelectField defaultValue="ollama">
              <option value="ollama">Ollama</option>
              <option value="custom-api">Custom API</option>
            </SelectField>
            <TextArea className="tall" placeholder="Text area" />
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h3>Menus</h3>
          <div className="ui-dev-inline">
            <Menu>
              <MenuTrigger asChild>
                <ActionButton trailingIcon={<ChevronDownIcon />}>Model</ActionButton>
              </MenuTrigger>
              <MenuContent>
                <MenuGroup>
                  <MenuLabel>Ollama</MenuLabel>
                  <MenuCheckboxItem checked>
                    <MenuItemLabel>Qwen 2.5 Coder</MenuItemLabel>
                    <CheckIcon />
                  </MenuCheckboxItem>
                  <MenuItem>
                    <MenuItemLabel>Qwen 3</MenuItemLabel>
                  </MenuItem>
                  <MenuSeparator />
                  <MenuLabel>Custom API</MenuLabel>
                  <MenuItem>
                    <MenuItemLabel>GPT-5.4 Nano</MenuItemLabel>
                  </MenuItem>
                </MenuGroup>
              </MenuContent>
            </Menu>

            <IconButton label="Add item">
              <PlusIcon />
            </IconButton>
            <IconButton label="Send" tone="default">
              <SendIcon />
            </IconButton>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h3>Sidebar Rows</h3>
          <div className="ui-dev-stack">
            <ProjectTreeButton className="project-row is-active" leadingIcon={<SidebarIcon><FolderIcon /></SidebarIcon>}>
              <span className="project-name">northbridge</span>
            </ProjectTreeButton>
            <ThreadTreeButton className="sidebar-thread-row is-active" trailingIcon={<span className="sidebar-thread-time">1h</span>}>
              <span className="sidebar-thread-title">
                <SidebarIcon><ThreadDotIcon /></SidebarIcon>
                <span>Align session-drop-all with discovery</span>
              </span>
            </ThreadTreeButton>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h3>Status</h3>
          <div className="ui-dev-inline ui-dev-wrap">
            <StatusPill tone="connected">connected</StatusPill>
          <StatusPill tone="detected">detected</StatusPill>
            <StatusPill tone="failed">failed</StatusPill>
            <StatusPill tone="completed">completed</StatusPill>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h3>Composer Controls</h3>
          <div className="ui-dev-inline ui-dev-wrap">
            <ActionButton tone="quiet" size="compact" leadingIcon={<AccountIcon />}>Ollama</ActionButton>
            <ActionButton tone="quiet" size="compact" trailingIcon={<ChevronDownIcon />}>Qwen 2.5</ActionButton>
            <ActionButton tone="quiet" size="compact" trailingIcon={<ChevronDownIcon />}>High</ActionButton>
            <IconButton label="Mic" tone="quiet"><AccountIcon /></IconButton>
            <IconButton label="Send"><SendIcon /></IconButton>
          </div>
        </SurfaceCard>
      </div>
    </section>
  );
}
