const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { generateWorkflow } = require('./workflow-generator');

const app = express();

// Debug PORT configuration
console.log('🔍 Environment PORT:', process.env.PORT);
console.log('🔍 All env vars:', Object.keys(process.env).filter(key => key.includes('PORT') || key.includes('RAILWAY')));

// Use Railway's PORT or fallback to 4000
const PORT = process.env.PORT || 4000;
console.log(`🎯 Using PORT: ${PORT}`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// File to store projects
const PROJECTS_FILE = path.join(__dirname, 'projects.json');

// Initialize projects file if it doesn't exist
async function initializeProjects() {
    try {
        await fs.access(PROJECTS_FILE);
        console.log('Found existing projects file');
    } catch (error) {
        await fs.writeFile(PROJECTS_FILE, JSON.stringify([]));
        console.log('Created new projects file');
    }
}

// Load projects from file
async function loadProjects() {
    try {
        const data = await fs.readFile(PROJECTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading projects:', error);
        return [];
    }
}

// Save projects to file
async function saveProjects(projects) {
    await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// API Routes

// Test ODK connection
app.post('/api/test-connection', async (req, res) => {
    console.log('📡 Testing connection with:', { 
        url: req.body.url, 
        email: req.body.email,
        projectId: req.body.projectId,
        formId: req.body.formId 
    });
    
    const { url, email, password, projectId, formId } = req.body;
    
    try {
        // Test connection to ODK Central
        console.log('🔐 Authenticating with ODK...');
        const authResponse = await fetch(`${url}/v1/sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password })
        });

        if (!authResponse.ok) {
            throw new Error('Authentication failed');
        }

        const { token } = await authResponse.json();
        console.log('✅ Authentication successful');

        // Try to fetch form details
        console.log('📋 Fetching form details...');
        const formResponse = await fetch(
            `${url}/v1/projects/${projectId}/forms/${formId}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!formResponse.ok) {
            throw new Error('Could not access form');
        }

        // Get submission count
        const submissionsResponse = await fetch(
            `${url}/v1/projects/${projectId}/forms/${formId}/submissions`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        let submissionCount = 0;
        if (submissionsResponse.ok) {
            const submissions = await submissionsResponse.json();
            submissionCount = submissions.length;
        }

        console.log(`✅ Connection test successful. Found ${submissionCount} submissions`);
        res.json({ 
            success: true, 
            message: 'Connection successful',
            submissionCount 
        });
    } catch (error) {
        console.error('❌ Connection test failed:', error.message);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Get all projects
app.get('/api/projects', async (req, res) => {
    console.log('📋 Fetching all projects');
    const projects = await loadProjects();
    res.json(projects);
});

// Create new project
app.post('/api/projects', async (req, res) => {
    console.log('➕ Creating new project:', req.body.name);
    try {
        const projects = await loadProjects();
        const newProject = {
            id: Date.now().toString(),
            ...req.body,
            createdAt: new Date().toISOString()
        };
        
        projects.push(newProject);
        await saveProjects(projects);
        
        console.log('✅ Project created:', newProject.id);
        res.status(201).json(newProject);
    } catch (error) {
        console.error('❌ Failed to create project:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Update project
app.patch('/api/projects/:id', async (req, res) => {
    console.log('🔧 Updating project:', req.params.id);
    try {
        const projects = await loadProjects();
        const index = projects.findIndex(p => p.id === req.params.id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        projects[index] = { ...projects[index], ...req.body };
        await saveProjects(projects);
        
        console.log('✅ Project updated');
        res.json(projects[index]);
    } catch (error) {
        console.error('❌ Failed to update project:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Generate workflow for project
app.get('/api/projects/:id/workflow', async (req, res) => {
    console.log('🔄 Generating workflow for project:', req.params.id);
    try {
        const projects = await loadProjects();
        const project = projects.find(p => p.id === req.params.id);
        
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        const workflow = generateWorkflow(project);
        console.log('✅ Workflow generated');
        res.json(workflow);
    } catch (error) {
        console.error('❌ Failed to generate workflow:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        port: PORT,
        timestamp: new Date().toISOString() 
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize and start server
async function start() {
    try {
        await initializeProjects();
        
        // Listen on all interfaces with explicit host binding
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log('');
            console.log('🚀 TathminiAI Configuration Server Started!');
            console.log(`📡 Server running on http://0.0.0.0:${PORT}`);
            console.log(`🌐 External access: https://tathmini-config-server-production.up.railway.app`);
            console.log(`📊 Health check: https://tathmini-config-server-production.up.railway.app/health`);
            console.log('');
            
            loadProjects().then(projects => {
                console.log(`📋 Current projects: ${projects.length}`);
            });
        });

        // Keep the process alive
        process.stdin.resume();
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Handle shutdown signals
process.on('SIGTERM', () => {
    console.log('\n📛 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n📛 SIGINT received, shutting down gracefully...');
    process.exit(0);
});

// Start the server
start();