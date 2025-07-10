// TathminiAI Configuration Server
// File: config-server.js

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve the HTML interface

const PORT = process.env.CONFIG_PORT || 4000;
const PROJECTS_FILE = path.join(__dirname, 'projects.json');
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://your-n8n-server.com/webhook/update-project';

// In-memory storage (in production, use a database)
let projects = [];

// Load projects from file on startup
async function loadProjects() {
    try {
        const data = await fs.readFile(PROJECTS_FILE, 'utf8');
        projects = JSON.parse(data);
        console.log(`Loaded ${projects.length} projects from storage`);
    } catch (error) {
        console.log('No existing projects file, starting fresh');
        projects = [];
    }
}

// Save projects to file
async function saveProjects() {
    try {
        await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
        console.log('Projects saved to storage');
    } catch (error) {
        console.error('Error saving projects:', error);
    }
}

// ODK Connection Test Helper
async function testODKConnection(odkConfig) {
    try {
        const { odkServer, odkProjectId, odkUsername, odkPassword } = odkConfig;
        
        // Test basic connectivity
        const url = `${odkServer}/v1/projects/${odkProjectId}/forms`;
        console.log('Testing ODK connection to:', url);
        
        const response = await axios.get(url, {
            auth: {
                username: odkUsername,
                password: odkPassword
            },
            timeout: 10000
        });
        
        return {
            success: true,
            formsCount: response.data.length,
            forms: response.data.map(form => ({
                xmlFormId: form.xmlFormId,
                name: form.name,
                version: form.version
            }))
        };
    } catch (error) {
        console.error('ODK connection test failed:', error.message);
        return {
            success: false,
            error: error.response?.data?.message || error.message
        };
    }
}

// Update n8n workflow with new project configuration
async function updateN8nWorkflow(project) {
    try {
        // This would trigger n8n to update the workflow configuration
        const response = await axios.post(N8N_WEBHOOK_URL, {
            action: 'update_project',
            project: project
        });
        
        console.log('n8n workflow updated for project:', project.id);
        return { success: true };
    } catch (error) {
        console.error('Failed to update n8n workflow:', error.message);
        return { success: false, error: error.message };
    }
}

// Routes

// Serve the configuration interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all projects
app.get('/api/projects', (req, res) => {
    res.json({
        success: true,
        projects: projects.map(p => ({
            ...p,
            odkPassword: undefined // Don't send passwords
        }))
    });
});

// Get single project
app.get('/api/projects/:id', (req, res) => {
    const project = projects.find(p => p.id === parseInt(req.params.id));
    if (!project) {
        return res.status(404).json({ success: false, error: 'Project not found' });
    }
    
    res.json({
        success: true,
        project: {
            ...project,
            odkPassword: undefined // Don't send password
        }
    });
});

// Test ODK connection
app.post('/api/test-odk-connection', async (req, res) => {
    const { odkServer, odkProjectId, odkUsername, odkPassword } = req.body;
    
    if (!odkServer || !odkProjectId || !odkUsername || !odkPassword) {
        return res.status(400).json({
            success: false,
            error: 'Missing required ODK connection parameters'
        });
    }
    
    const result = await testODKConnection(req.body);
    res.json(result);
});

// Create new project
app.post('/api/projects', async (req, res) => {
    try {
        const projectData = req.body;
        
        // Validate required fields
        const required = ['title', 'odkServer', 'odkProjectId', 'odkFormId', 'odkUsername', 'odkPassword'];
        for (const field of required) {
            if (!projectData[field]) {
                return res.status(400).json({
                    success: false,
                    error: `Missing required field: ${field}`
                });
            }
        }
        
        // Test ODK connection before saving
        const connectionTest = await testODKConnection(projectData);
        if (!connectionTest.success) {
            return res.status(400).json({
                success: false,
                error: `ODK connection failed: ${connectionTest.error}`
            });
        }
        
        // Create new project
        const newProject = {
            id: Date.now(),
            ...projectData,
            status: 'active',
            createdAt: new Date().toISOString(),
            lastSync: null,
            totalSubmissions: 0,
            qualityScore: '0%'
        };
        
        projects.push(newProject);
        await saveProjects();
        
        // Update n8n workflow
        await updateN8nWorkflow(newProject);
        
        res.json({
            success: true,
            project: {
                ...newProject,
                odkPassword: undefined
            }
        });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update existing project
app.put('/api/projects/:id', async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const projectIndex = projects.findIndex(p => p.id === projectId);
        
        if (projectIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }
        
        const projectData = req.body;
        
        // Test ODK connection if credentials changed
        if (projectData.odkServer || projectData.odkUsername || projectData.odkPassword) {
            const connectionTest = await testODKConnection({
                odkServer: projectData.odkServer || projects[projectIndex].odkServer,
                odkProjectId: projectData.odkProjectId || projects[projectIndex].odkProjectId,
                odkUsername: projectData.odkUsername || projects[projectIndex].odkUsername,
                odkPassword: projectData.odkPassword || projects[projectIndex].odkPassword
            });
            
            if (!connectionTest.success) {
                return res.status(400).json({
                    success: false,
                    error: `ODK connection failed: ${connectionTest.error}`
                });
            }
        }
        
        // Update project
        projects[projectIndex] = {
            ...projects[projectIndex],
            ...projectData,
            updatedAt: new Date().toISOString()
        };
        
        await saveProjects();
        
        // Update n8n workflow
        await updateN8nWorkflow(projects[projectIndex]);
        
        res.json({
            success: true,
            project: {
                ...projects[projectIndex],
                odkPassword: undefined
            }
        });
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete project
app.delete('/api/projects/:id', async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const projectIndex = projects.findIndex(p => p.id === projectId);
        
        if (projectIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }
        
        const deletedProject = projects.splice(projectIndex, 1)[0];
        await saveProjects();
        
        // Notify n8n to remove workflow
        await updateN8nWorkflow({ ...deletedProject, status: 'deleted' });
        
        res.json({
            success: true,
            message: 'Project deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get project statistics
app.get('/api/projects/:id/stats', async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const project = projects.find(p => p.id === projectId);
        
        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }
        
        // In production, this would query your Airtable or database
        // For now, return mock data
        const stats = {
            totalSubmissions: project.totalSubmissions || 0,
            qualityScore: project.qualityScore || '0%',
            lastSync: project.lastSync,
            recentSubmissions: [
                {
                    date: '2025-07-10',
                    count: 5,
                    quality: '95%'
                },
                {
                    date: '2025-07-09', 
                    count: 3,
                    quality: '100%'
                }
            ],
            trends: {
                submissionsThisWeek: 12,
                submissionsLastWeek: 8,
                averageQuality: '97.5%'
            }
        };
        
        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error('Error getting project stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update project status (activate/deactivate)
app.patch('/api/projects/:id/status', async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const { status } = req.body;
        
        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Status must be either "active" or "inactive"'
            });
        }
        
        const projectIndex = projects.findIndex(p => p.id === projectId);
        if (projectIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }
        
        projects[projectIndex].status = status;
        projects[projectIndex].updatedAt = new Date().toISOString();
        
        await saveProjects();
        
        // Update n8n workflow
        await updateN8nWorkflow(projects[projectIndex]);
        
        res.json({
            success: true,
            project: {
                ...projects[projectIndex],
                odkPassword: undefined
            }
        });
    } catch (error) {
        console.error('Error updating project status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Trigger manual sync for a project
app.post('/api/projects/:id/sync', async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const project = projects.find(p => p.id === projectId);
        
        if (!project) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }
        
        // Trigger n8n workflow manually
        const response = await axios.post(N8N_WEBHOOK_URL, {
            action: 'manual_sync',
            project: project
        });
        
        res.json({
            success: true,
            message: 'Manual sync triggered successfully'
        });
    } catch (error) {
        console.error('Error triggering manual sync:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'TathminiAI Configuration Server',
        timestamp: new Date().toISOString(),
        projectsCount: projects.length
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Start server
async function startServer() {
    await loadProjects();
    
    app.listen(PORT, () => {
        console.log(`🌟 TathminiAI Configuration Server running on port ${PORT}`);
        console.log(`📱 Web interface: http://localhost:${PORT}`);
        console.log(`🔗 API endpoint: http://localhost:${PORT}/api`);
        console.log(`📋 Current projects: ${projects.length}`);
    });
}

startServer().catch(console.error);